import nodemailer from "nodemailer";
import ejs from "ejs";
import { ApiError } from "./ApiError.js";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure transporter
let transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || "info@silentballacademy.com",
    pass: process.env.EMAIL_PASS || "ctxe perr jpjw apcy",
  },
  tls: {
    rejectUnauthorized: false,
  },
  debug: true,
});

const sendEmail = async ({ to, subject, variables }) => {
  try {
    const templatePath = path.join(__dirname, "../utils/emailtemplate.html");

    const htmlContent = await ejs.renderFile(templatePath, variables);

    const mailOptions = {
      from: process.env.MAIL_FROM_ADDRESS || "Silent Ball <info@silentballacademy.com>",
      to,
      subject,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending email:", error);
    throw new ApiError(500, "Error sending email", [error.message]);
  }
};

export { sendEmail };
