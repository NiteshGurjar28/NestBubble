import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";


const VendorSchema = new mongoose.Schema({
    vendorId: {
        type: String,
        required: true,
        unique: true,
        default: function() {
        return 'VEND' +  Date.now().toString().slice(-6) + Math.random().toString(36).substr(2, 3).toUpperCase();
        }
    },
    vendorType: {
        type: String,
        enum: ['individual', 'business'],
        required: true
    },
    userId : {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    firstName: { type: String },
    lastName: { type: String },
    phoneNumber: { type: String},
    emailAddress : { type: String },
    yearsOfExperience: { type: Number },
    languageSpoken: [{ type: String }],
    workingDaysAndHours: { type: String },
    address: { type: String },
    cityDistrict: { type: String },
    state: { type: String },
    pinCode: { type: String },
    residentialAddress: { 
        address: {
            type: String,
            required: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number],  // [longitude, latitude]
                required: true,
            }
        }
    },
    serviceableLocations: [{
        address: {
            type: String,
            required: true
        },
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], 
                required: true,
            }
        }
    }],
    paymentModeOfCommunication: { type: String },

    personalInfo: {
        alternatePhoneNumber: { type: String },
        dateOfBirth: { type: Date },
        gender: { type: String, enum: ['male', 'female', 'other'] },
    },
    businessInfo: {
        businessName: { type: String },
        businessType: { type: String },
        businessPhoneNumber: { type: String },
    },

    // Service Categories
    serviceCategories: [{
        type: Schema.Types.ObjectId,
        ref: 'ConciergeService',
    }],

    // Banking & Payment Details
    bankingDetails: {
        preferredPaymentMode: { 
            type: String
        },
        holderName : { type: String},
        bankName: { type: String},
        accountNumber: { type: String },
        ifscCode: { type: String},
        upiId: { type: String }
    },

    // File Uploads
    documents: {
        profilePhoto: { type: String }, // File path/URL
        businessPhoto: { type: String }, // File path/URL
        uploadDocuments: [{ 
            type: { type: String }, // Document type
            file: { type: String }, // File path/URL
            name: { type: String }  // Original filename
        }]
    },

    // Pricing & Policy
    pricing: {
        pricingStructure: { type: String },
        priceRange: { type: Number },
        discountCodeId: { type: Schema.Types.ObjectId, ref: 'VendorDiscountCode' },
        refundPolicyId: { type: Schema.Types.ObjectId, ref: 'VendorRefundPolicy' },
        additionalNotes: { type: String }
    },

    // Terms & Conditions
    agreements: {
        termsAndConditions: { type: Boolean, default: false },
        authenticityOfDocuments: { type: Boolean, default: false },
        conductBackgroundVerification: { type: Boolean,  default: false },
        serviceLevelAgreement: { type: Boolean, default: false }
    },

    // Metadata
    status: {
        type: String,
        enum: ['pending', 'active', 'inactive'],
        default: 'pending'
    },
}, {
  timestamps: true
});

const VendorDiscountCodeSchema = new mongoose.Schema({
    codeName: { type: String, required: true },
    codeValue: { type: Number, required: true },
    status: { type: Boolean, default: true },
}, {
  timestamps: true
});

const VendorRefundPolicySchema = new mongoose.Schema({
    timeValue: { type: Number, required: true }, // Number of hours/days
    timeUnit: { type: String, required: true, enum: ['hours', 'days'] }, // hours or days
    percentage: { type: Number, required: true, min: 0, max: 100 }, // Refund percentage
    status: { type: Boolean, default: true },
}, {
  timestamps: true
});


VendorSchema.plugin(mongooseAggregatePaginate);
VendorDiscountCodeSchema.plugin(mongooseAggregatePaginate);
VendorRefundPolicySchema.plugin(mongooseAggregatePaginate);


export const Vendor = mongoose.model("Vendor", VendorSchema);
export const VendorDiscountCode = mongoose.model("VendorDiscountCode", VendorDiscountCodeSchema);
export const VendorRefundPolicy = mongoose.model("VendorRefundPolicy", VendorRefundPolicySchema);


