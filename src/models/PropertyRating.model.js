import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const propertyRatingSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true 
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comfortableRating: {
    type: Number,
    min: 1,
    max: 5
  },
  cleanlinessRating: {
    type: Number,
    min: 1,
    max: 5
  },
  facilitiesRating: {
    type: Number,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const propertySuggestionSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true 
  },
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  suggestion: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});


propertyRatingSchema.plugin(mongooseAggregatePaginate);
propertySuggestionSchema.plugin(mongooseAggregatePaginate);

export const PropertyRating = mongoose.model("PropertyRating", propertyRatingSchema);
export const PropertySuggestion = mongoose.model("PropertySuggestion", propertySuggestionSchema);
