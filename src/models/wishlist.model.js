import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true
    }
  },
  { timestamps: true }
);

// Compound index to ensure a user can't add same property to wishlist multiple times
wishlistSchema.index({ user: 1, property: 1 }, { unique: true });

export const Wishlist = mongoose.model("Wishlist", wishlistSchema);