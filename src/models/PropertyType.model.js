import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";


const propertyTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    unique: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  properties: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  }],
  image: {
    type: String,
    trim: true 
  },
  cleaningFees: {
    shortStay: { 
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    longStay: {  // 3+ nights
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
  },
  status: {
    type: Boolean,
    default: true
  },
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

// Add text index for search functionality
propertyTypeSchema.index({ name: 'text', description: 'text' });
propertyTypeSchema.plugin(mongooseAggregatePaginate);

export const PropertyType = mongoose.model("PropertyType", propertyTypeSchema);
