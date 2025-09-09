import { name } from "ejs";
import mongoose from "mongoose";
import slugify from 'slugify';


const conciergeServiceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    // required: [true, 'Slug is required'],
    unique: true,
    trim: true,
    lowercase: true
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    type: String,
    trim: true 
  },
  status: {
    type: Boolean,
    default: true
  },
  bookingForm: [{
      label : { type: String, trim: true },
      name: { type: String , trim: true },
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});


// Auto-generate slug before saving
conciergeServiceSchema.pre('save', async function(next) {
  if (!this.isModified('name')) return next();
  
  try {
    // Generate base slug
    this.slug = slugify(this.name, {
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

// Also handle updates if name changes
conciergeServiceSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  if (update.name) {
    try {
      const docToUpdate = await this.model.findOne(this.getQuery());
      const newSlug = slugify(update.name, {
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


export const ConciergeService = mongoose.model("ConciergeService", conciergeServiceSchema);