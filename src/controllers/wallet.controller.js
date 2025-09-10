import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Wallet, WalletTransaction } from "../models/Wallet.model.js";
import { User } from "../models/user.model.js";
import Razorpay from "razorpay";

function inrToPaise(amountInInr) {
  return Math.round(Number(amountInInr) * 100);
}

async function getOrCreateWallet(userId, userRole) {
  let wallet = await Wallet.findOne({ userId, userRole });
  if (!wallet) {
    wallet = await Wallet.create({ userId, userRole, currency: "INR" });
  }
  return wallet;
}

function buildRazorpayClient() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay credentials missing in environment variables");
  }
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

async function ensureRazorpayContactAndFundAccount(razorpay, user) {
  // Try to reuse stored ids
  let needsSave = false;
  if (!user.payout) user.payout = {};

  if (!user.payout.razorpayContactId) {
    const contact = await razorpay.contacts.create({
      name: `${user.firstName || "User"} ${user.lastName || ""}`.trim(),
      email: user.email || undefined,
      contact: user.mobile || undefined,
      type: "customer",
    });
    user.payout.razorpayContactId = contact.id;
    needsSave = true;
  }

  if (!user.payout.razorpayFundAccountId) {
    if (user.payout.accountType === "bank_account") {
      if (!user.payout.bank?.ifsc || !user.payout.bank?.account_number) {
        throw new ApiError(400, "Bank details missing. Provide ifsc and account_number.");
      }
      const fund = await razorpay.fundAccount.create({
        contact_id: user.payout.razorpayContactId,
        account_type: "bank_account",
        bank_account: {
          name: user.payout.bank?.beneficiary_name || `${user.firstName || "User"} ${user.lastName || ""}`.trim(),
          ifsc: user.payout.bank.ifsc,
          account_number: user.payout.bank.account_number,
        },
      });
      user.payout.razorpayFundAccountId = fund.id;
      needsSave = true;
    } else if (user.payout.accountType === "vpa") {
      if (!user.payout.vpa?.address) {
        throw new ApiError(400, "VPA address missing for payout.");
      }
      const fund = await razorpay.fundAccount.create({
        contact_id: user.payout.razorpayContactId,
        account_type: "vpa",
        vpa: { address: user.payout.vpa.address },
      });
      user.payout.razorpayFundAccountId = fund.id;
      needsSave = true;
    } else {
      throw new ApiError(400, "Set payout.accountType to 'bank_account' or 'vpa'.");
    }
  }

  if (needsSave) await user.save();
  return { contactId: user.payout.razorpayContactId, fundAccountId: user.payout.razorpayFundAccountId };
}

const initiateWithdrawal = asyncHandler(async (req, res) => {
  const { amount, mode = "IMPS", purpose = "payout", notes } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json(new ApiError(400, "Valid amount is required"));
  }

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json(new ApiError(404, "User not found"));

  const userRole = req.user.roles.includes("host") && req.user.activeRole === "host" ? "host" : "guest";
  const wallet = await getOrCreateWallet(user._id, userRole);

  if (Number(wallet.balance) < Number(amount)) {
    return res.status(400).json(new ApiError(400, "Insufficient wallet balance"));
  }

  const razorpay = buildRazorpayClient();
  const { fundAccountId } = await ensureRazorpayContactAndFundAccount(razorpay, user);

  const amountInPaise = inrToPaise(amount);

  const tx = await WalletTransaction.create({
    walletId: wallet._id,
    amount: Number(amount),
    transactionType: "withdrawal",
    status: "pending",
    metadata: { mode, purpose },
  });

  try {
    // Create payout
    const payoutPayload = {
      account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER, // e.g., 2323230070722907
      fund_account_id: fundAccountId,
      amount: amountInPaise,
      currency: "INR",
      mode,
      purpose,
      queue_if_low_balance: true,
      reference_id: tx._id.toString(),
      narration: `Withdrawal ${userRole}`,
      notes: notes || {},
    };

    const payout = await razorpay.payouts.create(payoutPayload);

    // Optimistically deduct and mark completed if processed/queued
    wallet.balance = Number(wallet.balance) - Number(amount);
    await wallet.save();

    tx.status = ["processing", "queued", "pending", "created"].includes(payout.status)
      ? "pending"
      : payout.status === "processed"
      ? "completed"
      : "pending";
    tx.metadata = { ...(tx.metadata || {}), payoutId: payout.id, payoutStatus: payout.status };
    await tx.save();

    return res.status(200).json(new ApiResponse(200, { payoutId: payout.id, status: payout.status, wallet }, "Withdrawal initiated"));
  } catch (err) {
    tx.status = "failed";
    tx.metadata = { ...(tx.metadata || {}), error: err.message };
    await tx.save();
    return res.status(500).json(new ApiError(500, "Payout failed", err.message));
  }
});

const getWalletInfo = asyncHandler(async (req, res) => {
  const userRole = req.user.roles.includes("host") && req.user.activeRole === "host" ? "host" : "guest";
  const wallet = await getOrCreateWallet(req.user._id, userRole);
  const transactions = await WalletTransaction.find({ walletId: wallet._id }).sort({ createdAt: -1 }).limit(50).lean();
  return res.status(200).json(new ApiResponse(200, { wallet, transactions }));
});

export { initiateWithdrawal, getWalletInfo };

