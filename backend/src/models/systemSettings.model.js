import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default",
    },
    plexiviaSupport: {
      apiBaseUrl: { type: String, default: "https://api.plexivia.com" },
      keyEnc: { type: String, default: "" },
      keyHint: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
      updatedBy: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const SystemSettingsModel =
  mongoose.models.SystemSettings || mongoose.model("SystemSettings", systemSettingsSchema);
