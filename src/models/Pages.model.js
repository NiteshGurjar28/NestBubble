import mongoose from "mongoose";

const pageSchema = new mongoose.Schema({
  pageType: {
    type: String,
    required: true,
    enum: ['home', 'about', 'contact', 'services', 'privacy', 'terms', 'faq', 'custom'],
    unique: true
  },
  title: {
    type: String,
  },
  slug: {
    type: String,
    unique: true
  },
  subtitle: {
    type: String
  },
  content: {
    type: String
  },
  sliderImages: [{
      title: String,
      subtitle: String,
      content: String,
      image: String,
  }],
  selectedItems: {
    propertyTypes: {
      title: String,
      selectedTypes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PropertyType'
      }]
    },
    services: {
      title: String,
      selectedServices: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ConciergeService'
      }]
    },
    events: {
      title: String,
      selectedEvents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EventCategory'
      }]
    }
  }
}, { timestamps: true });

// Indexes
pageSchema.index({ pageType: 1, isActive: 1 });

export const Pages = mongoose.model("Pages", pageSchema);
