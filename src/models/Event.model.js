import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
import slugify from 'slugify';

const eventSchema = new mongoose.Schema(
  {
    title: {
        type: String,
        required: [true, 'Event title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    slug: {
        type: String,
        unique: true,
        trim: true,
        lowercase: true
    },
    eventType: {
        type: String,
        enum: ['public', 'private'],
        default: 'public'
    },
    categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EventCategory',
        required: [true, 'Category is required']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required']
    },
    duration: {
        type: Number,
        default: 1
    },
    startTime: {
        type: String,
    },
    endTime: {
        type: String,
    },
    maxParticipants: {
        type: Number,
        min: [1, 'Minimum 1 participant required'],
        default: 20
    },
    currentAttendees: {
        type: Number,
        default: 0
    },
    ageRestriction: {
        type: Number,
        default: 18
    },
    eventLanguage: [{
        type: String,
    }],
    includedItems: [{
        type: String,
        trim: true
    }],
    // New field: What to bring
    whatToBring: [{
        type: String,
        trim: true
    }],
    location: {
        address: String,
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],  // [longitude, latitude]
            required: true,
        }
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative']
    },
    currency: {
        type: String,
        default: 'INR'
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    images: [{
        url: String,
        caption: String,
        isFeatured: Boolean
    }],
    // Updated: Only 1 video allowed
    video: { type: String, default: '' },
    safetyInfo: [{
        type: String,
        trim: true
    }],
    // New field: Terms agreement
    termsAgreement: {
        type: String,
    },
    organizer: {
        firstName: {
            type: String,
            required: [true, 'First name is required'],
            trim: true
        },
        lastName: {
            type: String,
            required: [true, 'Last name is required'],
            trim: true
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
        },
        mobileNumber: {
            type: String,
            required: [true, 'Mobile number is required']
        }
    },
    createdBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        role: {
            type: String,
            enum: ['admin', 'host', 'guest'],
            required: true
        }
    },
    status: {
        type: String,
        enum: ['upcoming', 'cancelled', 'completed'],
        default: 'upcoming'
    },
    cancellationReason: {
        type: String,
    },
    cancelRequest: {
        type: Boolean,
        default: false
    },
    requestedAt: {
        type: Date,
    },
    cancelledAt: {
        type: Date,
    },
    cancelledBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        role: {
            type: String,
            enum: ['admin', 'host', 'guest'],
        }
    }
  },
  { timestamps: true }
);

// Auto-generate slug before saving
eventSchema.pre('save', async function(next) {
  if (!this.isModified('title')) return next();
  
  try {
    // Generate base slug
    this.slug = slugify(this.title, {
      lower: true,
      strict: true,
      remove: /[*+~.()'"!:@]/g
    });
    
    // Check for uniqueness
    const slugCount = await this.constructor.countDocuments({ 
      slug: new RegExp(`^${this.slug}(-[0-9]*)?$`) 
    });
    
    if (slugCount > 0) {
      this.slug = `${this.slug}-${slugCount + 1}`;
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Also handle updates if title changes
eventSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  if (update.title) {
    try {
      const docToUpdate = await this.model.findOne(this.getQuery());
      const newSlug = slugify(update.title, {
        lower: true,
        strict: true,
        remove: /[*+~.()'"!:@]/g
      });
      
      // Only update if slug would change
      if (newSlug !== docToUpdate.slug) {
        let uniqueSlug = newSlug;
        let counter = 1;
        
        while (await this.model.exists({ slug: uniqueSlug, _id: { $ne: docToUpdate._id } })) {
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

eventSchema.plugin(mongooseAggregatePaginate);
export const Event = mongoose.model("Event", eventSchema);

