import mongoose from 'mongoose';
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ['user', 'admin'],
    required: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  attachments: [{
    url: String,
    name: String,
    type: String
  }],
  read: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

const helpCenterSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'TKT-' + Date.now().toString(36).toUpperCase() + 
             Math.floor(1000 + Math.random() * 9000).toString();
    }
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['account', 'payments', 'bookings', 'technical', 'other'],
    default: 'other'
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  initialMessage: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  messages: [messageSchema],
  lastRepliedBy: {
    type: String,
    enum: ['user', 'admin', null],
    default: null
  },
  unreadCount: {
    user: { type: Number, default: 0 },
    admin: { type: Number, default: 0 }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

helpCenterSchema.virtual('lastMessage').get(function() {
  if (this.messages && this.messages.length > 0) {
    return this.messages[this.messages.length - 1];
  }
  return null;
});

helpCenterSchema.plugin(mongooseAggregatePaginate);
messageSchema.plugin(mongooseAggregatePaginate);

export const HelpCenter = mongoose.model('HelpCenter', helpCenterSchema);

