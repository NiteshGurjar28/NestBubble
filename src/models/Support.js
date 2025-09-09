import mongoose from 'mongoose';
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const supportFaqSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true,
    // unique: true
  },
  answer: {
    type: String,
    required: true
  },
  parentQuestion: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportFaq',
    default: null
  },
  suggestQuestions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportFaq'
  }]
}, { timestamps: true });

const supportConversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportFaq',
  },
  questionText: {
    type: String,
    required: true
  },
  answerText: {
    type: String,
    required: true
  },
}, { timestamps: true });




supportFaqSchema.plugin(mongooseAggregatePaginate);

export const SupportFaq = mongoose.model('SupportFaq', supportFaqSchema);
export const SupportConversation = mongoose.model('SupportConversation', supportConversationSchema);
