import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const amenityRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reqName: {
    type: String,
    required: true
  },
  reqMessage: {
    type: String,
  },
  category: {
      type: String,
      enum: ['Basic Amenities', 'Standout Amenities', 'Safety Items'],
      required: true
  },
  reqStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  responseMessage: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const amenitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  category: {
      type: String,
      enum: ['Basic Amenities', 'Standout Amenities', 'Safety Items'],
      required: true
  },
  icon: {
    type: String // URL or icon class name
  },
  status: {
    type: Boolean, /// Amenity is 
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

amenitySchema.plugin(mongooseAggregatePaginate);
amenityRequestSchema.plugin(mongooseAggregatePaginate);

export const Amenity = mongoose.model("Amenity", amenitySchema);
export const AmenityRequest = mongoose.model("AmenityRequest", amenityRequestSchema);
