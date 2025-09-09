import { ActivityLog } from "../models/ActivityLog.model.js";
import { Event } from "../models/Event.model.js";
import { BookingEvent } from "../models/BookingEvent.model.js";
import { Booking } from "../models/Booking.model.js";
import { Wallet } from "../models/Wallet.model.js";

export const createActivityLog = async ({
  entityType,
  entityId,
  userId,
  userRole,
  action,
}) => {
  try {
    await ActivityLog.create({
      entityType,
      entityId,
      performedBy: {
        userId,
        role: userRole,
      },
      action,
    });
  } catch (error) {
    console.error("Error creating activity log:", error);
    // throw error;
  }
};

export const eventComplete = async () => {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const nowIST = new Date(now.getTime() + offset);

  // Get today's date string in IST
  const todayStr = nowIST.toISOString().split("T")[0];

  // Mongo query with timezone handling
  const eventsToUpdate = await Event.aggregate([
    {
      $match: {
        status: "upcoming",
        $or: [
          // Case 1: endDate < today
          {
            $expr: {
              $lt: [
                {
                  $dateFromString: {
                    dateString: { $substr: ["$endDate", 0, 10] },
                  },
                },
                new Date(todayStr),
              ],
            },
          },
          // Case 2: endDate = today AND endTime has passed
          {
            $and: [
              {
                $expr: {
                  $eq: [{ $substr: ["$endDate", 0, 10] }, todayStr],
                },
              },
              { endTime: { $exists: true, $ne: "" } },
              {
                $expr: {
                  $lt: [
                    {
                      // Convert IST endTime to UTC for proper comparison
                      $subtract: [
                        {
                          $dateFromString: {
                            dateString: {
                              $concat: [todayStr, "T", "$endTime", ":00.000Z"],
                            },
                          },
                        },
                        offset, // IST offset in milliseconds
                      ],
                    },
                    now,
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    {
      $project: {
        _id: 1,
        createdBy: 1,
      },
    },
  ]);


  if (eventsToUpdate.length > 0) {
    console.log("Events found to update:", eventsToUpdate.length);
    await Event.updateMany(
      { _id: { $in: eventsToUpdate.map((e) => e._id) } },
      { $set: { status: "completed" } }
    );
  }

  for (const event of eventsToUpdate) {
    try {
      // Get all confirmed bookings for this event
      const bookings = await BookingEvent.find({
        event: event._id,
        status: "confirmed",
      });

      if (!bookings.length) continue;

      const hostWallet = await Wallet.findOne({
        userId: event.createdBy.userId,
        userRole: event.createdBy.role,
      });

      if (!hostWallet) continue;

      let bookingAmount = 0;

      // Process each booking
      for (const booking of bookings) {
        if (booking.bookingBy.role === "guest") {
          bookingAmount += Number(booking.paymentDetails?.baseAmount || 0);
        }
      }

      hostWallet.holdBalance = Math.max(
        0,
        hostWallet.holdBalance - bookingAmount
      );
      hostWallet.balance = Math.max(0, hostWallet.balance + bookingAmount);

      await hostWallet.save();
    } catch (error) {
      console.error("Error in eventComplete function:", error);
    }
  }
};

export const propertyComplete = async () => {
  try {
    const now = new Date();

    // find all confirmed bookings where endDate is in the past
    const bookingsToUpdate = await Booking.find({
      status: "confirmed",
      "bookingDates.endDate": { $lt: now },
    }).select("_id hostId amountBreakdown");

    console.log("Bookings to complete:", bookingsToUpdate);

    if (bookingsToUpdate.length > 0) {
      // mark bookings as completed
      await Booking.updateMany(
        { _id: { $in: bookingsToUpdate.map((b) => b._id) } },
        { $set: { status: "completed" } }
      );

      // process wallet updates per booking
      for (const booking of bookingsToUpdate) {
        const hostWallet = await Wallet.findOne({
          userId: booking.hostId,
          userRole: "host",
        });

        if (!hostWallet) continue;

        const bookingAmount =
          Number(booking.amountBreakdown.finalAmount || 0) -
          Number(booking.amountBreakdown.totalTaxAmount || 0);

        hostWallet.holdBalance = Math.max(
          0,
          hostWallet.holdBalance - bookingAmount
        );
        hostWallet.balance = Math.max(0, hostWallet.balance + bookingAmount);

        await hostWallet.save();
      }

      console.log(`${bookingsToUpdate.length} bookings marked as completed.`);
    } else {
      console.log("No bookings to update.");
    }
  } catch (error) {
    console.error("Error in propertyComplete:", error);
  }
};


