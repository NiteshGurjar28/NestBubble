import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import expressEjsLayouts from "express-ejs-layouts";
import bodyParser from "body-parser";
import { formatPrice, formatDate, formatDateTime } from "./utils/format.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [
      "http://83.136.219.131:8062",
      "http://83.136.219.131:6020",
      "http://localhost:8062",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.locals.siteUrl = process.env.SITE_URL;

app.post("/webhook/stripe", express.raw({ type: "application/json" }), (req, res, next) => {
  // Let your router handle it
  next();
});

app.use(bodyParser.json());

app.use(express.json({ limit: "80kb" }));
app.use(express.urlencoded({ extended: true, limit: "80kb" }));
app.use(express.static("public"));
app.use(cookieParser());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set the views directory and engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(expressEjsLayouts);

app.locals.formatPrice = formatPrice;
app.locals.formatDate = formatDate;
app.locals.formatDateTime = formatDateTime;

// //routes import
import authRouter from "./routes/auth.routes.js";
import commonRouter from "./routes/common.routes.js";
import hostRouter from "./routes/host.routes.js";
import guestRouter from "./routes/guest.routes.js";
import adminRouter from "./routes/admin.routes.js";

// //routes declaration
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/common", commonRouter);
app.use("/api/v1/host", hostRouter);
app.use("/api/v1/guest", guestRouter);
app.use("/", adminRouter);
// app.use(express.static("public"));



export { app };
