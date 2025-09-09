import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const PermissionSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  }
}, { timestamps: true });

const AdminRolesSchema = new Schema({
    role: {
        type: String,
        enum: ['super_admin', 'customer_admin', 'manager_admin'],
        required: true,
        unique: true,
    },
    permissions: [{
        type: Schema.Types.ObjectId,
        ref: 'Permission',
    }],
}, { timestamps: true });


PermissionSchema.plugin(mongooseAggregatePaginate);

export const Permission = mongoose.model("Permission", PermissionSchema);
export const AdminRoles = mongoose.model("AdminRoles", AdminRolesSchema);
