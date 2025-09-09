// utils/calendar.js
import { PropertyCalendar } from "../models/PropertyCalendar.model.js";

/* ---------------- Date helpers (avoid dupes) ---------------- */
const toDateOnlyUTC = (d) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

/* ---------------- Weekend helper ---------------- */
export const isWeekend = (d, weekendDays = [5, 6]) =>
  weekendDays.includes(new Date(d).getUTCDay());

/* ---------------- Price compute (keeps your math) ---------------- */
export function computeNightPrice(date, property, propertyFee = 0) {
  const { pricing } = property;
  const weekend = isWeekend(date, pricing.weekendDays || [5, 6]);

  if (weekend && pricing.customWeekendPriceStatus) {
    // weekend override if enabled, else fallback to base
    const base = Number(pricing.baseAmount || 0);
    const wk = Number(pricing.customWeekendPrice || base);

    return {
      priceBeforeTax: wk || base,
      price:
        Math.round(wk + (wk * Number(propertyFee)) / 100) ||
        Math.round(base + (base * Number(propertyFee)) / 100),
      priceSource: "weekend",
      isWeekend: true,
    };
  }

  const base = Number(pricing.baseAmount || 0);
  return {
    priceBeforeTax: base,
    price: Math.round(base + (base * Number(propertyFee)) / 100),
    priceSource: "base",
    isWeekend: weekend,
  };
}

/* ---------------- Seed calendar [start, end) — INSERT ONLY ----------------
   Important: we DO NOT overwrite existing docs; only create missing days.
--------------------------------------------------------------------------- */
export async function seedPropertyCalendar(
  property,
  startDate,
  endDate,
  propertyFee = 0
) {
  const ops = [];
  const start = toDateOnlyUTC(startDate);
  const stop = toDateOnlyUTC(endDate);

  for (let d = new Date(start); d < stop; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = new Date(d); // already midnight UTC
    const { priceBeforeTax, price, priceSource, isWeekend } = computeNightPrice(
      day,
      property,
      propertyFee
    );

    ops.push({
      updateOne: {
        filter: { propertyId: property._id, date: day },
        update: {
          // INSERT ONLY — nothing here overwrites existing docs
          $setOnInsert: {
            propertyId: property._id,
            date: day,
            status: "available",
            note: null,
            bookingId: null,
            priceBeforeTax,
            price,
            priceSource,
            isWeekend,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length) await PropertyCalendar.bulkWrite(ops, { ordered: false });
}

/* ---------------- Manual price for a range (skip booked) ---------------- */
export async function setManualPriceRange(
  propertyId,
  startDate,
  endDate,
  priceBeforeTax,
  price
) {
  const start = toDateOnlyUTC(startDate);
  const stop = toDateOnlyUTC(endDate);

  return PropertyCalendar.updateMany(
    {
      propertyId,
      date: { $gte: start, $lt: stop },
      status: { $ne: "booked" }, // don't change booked nights
    },
    { $set: { priceBeforeTax, price, priceSource: "manual" } }
  );
}

/* ---------------- Block / Unblock (skip booked) ---------------- */
export async function setAvailabilityRange(
  propertyId,
  startDate,
  endDate,
  status,
  note = null
) {
  const start = toDateOnlyUTC(startDate);
  const stop = toDateOnlyUTC(endDate);

  if (!["available", "blocked"].includes(status)) {
    throw new Error("Invalid status for bulk availability change");
  }

  return PropertyCalendar.updateMany(
    {
      propertyId,
      date: { $gte: start, $lt: stop },
      status: { $ne: "booked" }, // never override booked
    },
    { $set: { status, note: status === "blocked" ? note || "Blocked" : null } }
  );
}

/* ---------------- Reprice future window (safe) ----------------
   Reprice ONLY rows that are:
   - status = available (change this to "booked" while testing if you want),
   - priceSource in ["base","weekend"] (manual/smart remain unchanged).
----------------------------------------------------------------- */
export async function repriceFutureCalendarWindow(
  property,
  startDate,
  endDate,
  propertyFee = 0
) {
  const start = toDateOnlyUTC(startDate);
  const stop = toDateOnlyUTC(endDate);

  const rows = await PropertyCalendar.find({
    propertyId: property._id,
    date: { $gte: start, $lt: stop },
    status: { $in: ["available", "blocked"] },
    priceSource: { $in: ["base", "weekend"] }, // don't touch manual/smart
  })
    .select({ _id: 1, date: 1 })
    .lean();
  console.log(`Repricing ${rows.length} calendar rows...`);
  if (!rows.length) return;

  const ops = rows.map((r) => {
    const { priceBeforeTax, price, priceSource, isWeekend } = computeNightPrice(
      r.date,
      property,
      propertyFee
    );

    return {
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { priceBeforeTax, price, priceSource, isWeekend } },
      },
    };
  });

  await PropertyCalendar.bulkWrite(ops, { ordered: false });
}
