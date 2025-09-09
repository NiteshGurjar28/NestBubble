
import mongoose from "mongoose";

const settingSchema = new mongoose.Schema({
    email: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    location: {
        lat: { type: Number },
        lng: { type: Number }
    },
    phone: {
        type: String,
        trim: true
    },
    logo: {
        type: String,
        trim: true
    },
    fees: {
        property: {
            type: Number,
            default: 10,
            min: 0,
            max: 100,
        },
        event: {
            type: Number,
            default: 15,
            min: 0,
            max: 100
        },
        // currency: {
        //     type: String,
        //     default: 'INR',
        //     enum: ['INR', 'EUR', 'GBP', 'USD'] // Add more as needed
        // },
        // taxRate: {
        //     type: Number,
        //     default: 0,
        //     min: 0,
        //     max: 100
        // }
    },
    socialMedia: {
        facebook: { type: String, trim: true },
        twitter: { type: String, trim: true },
        instagram: { type: String, trim: true },
        linkedin: { type: String, trim: true }
    },
    seo: {
        metaTitle: { type: String, trim: true },
        metaDescription: { type: String, trim: true },
        keywords: { type: String, trim: true }
    }
}, { timestamps: true });

const faqSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        trim: true
    },
    answer: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        required: true,
        enum: ['home', 'product', 'service', 'general', 'payment', 'shipping'],
        default: 'general'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    order: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Indexes
settingSchema.index({ createdAt: -1 });
faqSchema.index({ type: 1, order: 1 });

export const Setting = mongoose.model("Setting", settingSchema);
export const FAQ = mongoose.model("FAQ", faqSchema);
