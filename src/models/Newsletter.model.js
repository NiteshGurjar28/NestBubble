import mongoose from 'mongoose';
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const newsletterSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  isSubscribed: {
    type: Boolean,
    default: true
  },
  subscribedAt: {
    type: Date,
    default: Date.now()
  },
  unsubscribedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

const comingSoonSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/.+\@.+\..+/, "Please enter a valid email"],
  },
  isFirst100: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Number,
    default: 0,
  },
},{ timestamps: true });

comingSoonSchema.pre("save", async function (next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    if (count < 100) {
      this.isFirst100 = true;
      this.position = count + 1;
    }
  }
  next();
});

comingSoonSchema.plugin(mongooseAggregatePaginate);

export const ComingSoon = mongoose.model('ComingSoon', comingSoonSchema);
export const Newsletter = mongoose.model('Newsletter', newsletterSchema);