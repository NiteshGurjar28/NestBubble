import mongoose from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const ContactEnquirySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        match: [/.+\@.+\..+/, 'Please fill a valid email address']
    },
    phoneNumber: {  // Changed from 'phone' to match the form
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ContactEnquiryType',
    },
    message: {  
        type: String,
        trim: true,
        maxlength: 500
    },
    status: {
        type: String,
        enum: ['pending', 'resolved', 'cancelled'],
        default: 'pending'
    },
    responses: [{
        message: String,
        respondedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        respondedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, { timestamps: true });

const ContactEnquiryTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    status: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

ContactEnquirySchema.plugin(mongooseAggregatePaginate);

export const ContactEnquiry = mongoose.model("ContactEnquiry", ContactEnquirySchema);
export const ContactEnquiryType = mongoose.model("ContactEnquiryType", ContactEnquiryTypeSchema);

