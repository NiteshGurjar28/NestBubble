import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
import slugify from "slugify";

const propertySchema = new mongoose.Schema(
  {
    // Basic Information
    propertyUID: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return (
          "PR" +
          Date.now().toString().slice(-6) +
          Math.random().toString(36).substr(2, 3).toUpperCase()
        );
      },
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      sparse: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    slug: {
      type: String,
      // required: [true, 'Slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    topVacation: {
      type: Boolean,
      default: false,
    },

    // Ownership Information
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Property Type and Status
    propertyType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PropertyType",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    adminApprovalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      trim: true,
    },

    // Location Details
    address: {
      street: { type: String, required: true, trim: true },
      landmark: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      district: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      country: { type: String, required: true, trim: true, default: "India" },
      pincode: { type: String, required: true, trim: true },
    },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },

    // Property Specifications
    buildYear: {
      type: Number,
      min: 1800,
      max: new Date().getFullYear(),
    },
    landSize: {
      value: { type: Number, required: true },
      unit: {
        type: String,
        enum: ["sqft", "sqm", "acre", "hectare"],
        default: "sqft",
      },
    },

    // Accommodation Details
    capacity: {
      guestsAllowed: { type: Number, required: true, min: 1 },
      bedrooms: { type: Number, required: true, min: 1 },
      beds: { type: Number, required: true, min: 1 },
      bathrooms: { type: Number, required: true, min: 1 },
      garages: { type: Number, default: 0 },
    },

    // Pricing Information
    pricing: {
      baseAmount: { type: Number, required: true, min: 0 },
      customWeekendPriceStatus: { type: Boolean, default: false },
      customWeekendPrice: { type: Number, default: 0 },
    },

    /// Discounts and Promotions
    discounts: {
      weeklyDiscount: {
        status: { type: Boolean, default: true },
        percentage: { type: Number, default: 14 },
      },
      monthlyDiscount: {
        status: { type: Boolean, default: true },
        percentage: { type: Number, default: 22 },
      },
      lastMintDiscount: {
        status: { type: Boolean, default: false },
        percentage: { type: Number, default: 0 },
        beforeDays: { type: Number, default: 0 },
      },
      newListingDiscount: {
        status: { type: Boolean, default: true },
        percentage: { type: Number, default: 20 },
      },
    },

    // Amenities
    amenities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Amenity",
      },
    ],

    // Extra Features
    extraFeatures: {
      clubHouse: {
        available: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
      car: {
        available: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
      carwithDriver: {
        available: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
      maidService: {
        available: { type: Boolean, default: false },
        amount: { type: Number, default: 0 },
      },
    },

    // Media
    images: [
      {
        url: { type: String, required: true },
        isFeatured: { type: Boolean, default: false },
        caption: { type: String, trim: true },
        uploadDate: { type: Date, default: Date.now },
      },
    ],
    videos: [
      {
        url: { type: String, required: true },
        isFeatured: { type: Boolean, default: false },
        caption: { type: String, trim: true },
        uploadDate: { type: Date, default: Date.now },
      },
    ],
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      set: (v) => parseFloat(v.toFixed(2)), // Always store with 2 decimal places
    },
    averageComfortableRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      set: (v) => parseFloat(v.toFixed(2)),
    },
    averageCleanlinessRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      set: (v) => parseFloat(v.toFixed(2)),
    },
    averageFacilitiesRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      set: (v) => parseFloat(v.toFixed(2)),
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Add geospatial index for coordinates
propertySchema.index({ coordinates: "2dsphere" });

// Virtual for full address
propertySchema.virtual("fullAddress").get(function () {
  return `${
    this.address.street
  }, ${this.address.landmark ? this.address.landmark + ", " : ""}${this.address.city}, ${this.address.state}, ${this.address.country} - ${this.address.pincode}`;
});

propertySchema.virtual("todayPrice", {
  ref: "PropertyCalendar",
  localField: "_id",
  foreignField: "propertyId",
  justOne: true,
  match: {
    date: {
      $gte: new Date(new Date().setHours(0,0,0,0)), // start of today
      $lt: new Date(new Date().setHours(23,59,59,999)) // end of today
    }
  }
});

// Auto-generate slug before saving
propertySchema.pre("save", async function (next) {
  if (!this.isModified("name")) return next();

  try {
    // Generate base slug
    this.slug = slugify(this.name, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g,
    });

    // Check for uniqueness
    const slugCount = await this.constructor.countDocuments({
      slug: new RegExp(`^${this.slug}(-[0-9]*)?$`),
    });

    if (slugCount > 0) {
      this.slug = `${this.slug}-${slugCount + 1}`;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Also handle updates if name changes
propertySchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate();
  if (update.name) {
    try {
      const docToUpdate = await this.model.findOne(this.getQuery());
      const newSlug = slugify(update.name, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g,
      });

      // Only update if slug would change
      if (newSlug !== docToUpdate.slug) {
        let uniqueSlug = newSlug;
        let counter = 1;

        while (
          await this.model.exists({
            slug: uniqueSlug,
            _id: { $ne: docToUpdate._id },
          })
        ) {
          uniqueSlug = `${newSlug}-${counter}`;
          counter++;
        }

        this.set({ slug: uniqueSlug });
      }

      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// Aggregate paginate plugin
propertySchema.plugin(mongooseAggregatePaginate);

export const Property = mongoose.model("Property", propertySchema);
