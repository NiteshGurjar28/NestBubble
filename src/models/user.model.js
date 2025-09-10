import mongoose, { Schema } from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const userSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      default: function() {
        return 'USR' + Date.now().toString().slice(-6) + Math.random().toString(36).substr(2, 3).toUpperCase(); 
      }
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null
    },
    password: {
      type: String,
    },
    countryCode: {
      type: String,
      default: '91'
    },
    mobile: {
      type: String,
      unique: true,
      trim: true
    },
    address: {
        street: { type: String, default: '' },
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        postalCode: { type: String, default: '' },
        coordinates: {
            type: { type: String, default: 'Point', required: false },
            coordinates: { 
                type: [Number],
                required: false
            }
        }
    },
    profileImage: {
        type: String,
        default: '/temp/default-user.png'
    },
    backgroundImage: {
        type: String, 
    },
    mobileOtp: {
      code: String,
      expiresAt: Date
    },
    isActive: {
      type: Boolean,
      default: true
    },
    profileCompletionStatus: {
      type: String,
      enum: ['incomplete', 'complete'],
      default: 'incomplete'
    },
    socialAuth: {
      googleId: String,
      appleId: String
    },
    // fcmToken: {
    //   type: String, 
    // },
    kyc: {
      aadharNumber: String,
      panNumber: String,
      aadharFrontImage: String,
      aadharBackImage: String,
      panImage: String,
      aadharVerified: {
        type: Boolean,
        default: false
      },
      panVerified: {
        type: Boolean,
        default: false
      }
    },
    kycStatus: {
      type: Boolean,
      default: false
    },
    acceptedTerms: {
      type: Boolean,
      default: false
    },
    roles: {
      type: [{
        type: String,
        enum: ['guest', 'host', 'admin']
      }],
      default: ['guest']
    },
    adminRole: {
      type: String,
      enum: ['super_admin', 'customer_admin', 'manager_admin'],
    },
    activeRole: {
      type: String,
      enum: ['guest', 'host'],
      default: 'guest'
    },
    lastLogin: {
      type: Date,
    },
    passwordChangedAt: {
      type: Date,
    },
    refreshToken: {
      type: String,
    },
    accessToken: {
      type: String,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    autoAcceptedIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    eventRating:{
        type: Number,
        default: 0
    },
    hostVerified: {
      type: Boolean,
      default: false
    }
    ,
    uberAuth: {
      accessToken: { type: String },
      refreshToken: { type: String },
      expiresAt: { type: Date },
      scope: { type: String },
      lastUpdatedAt: { type: Date }
    },
    payout: {
      razorpayContactId: { type: String },
      razorpayFundAccountId: { type: String },
      accountType: { type: String, enum: ["bank_account", "vpa"] },
      bank: {
        name: { type: String },
        ifsc: { type: String },
        account_number: { type: String },
        beneficiary_name: { type: String }
      },
      vpa: { address: { type: String } },
      lastPayoutAt: { type: Date }
    }
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
};

userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    }
  );
};

userSchema.index({ email: 1 }, { 
  unique: true, 
  partialFilterExpression: { email: { $type: "string" } }
});

userSchema.plugin(mongooseAggregatePaginate);

export const User = mongoose.model("User", userSchema);
