import dotenv from "dotenv";
import connectDB from "./db/index.js";
import { app } from "./app.js";
import http from "http";
import { initSocket } from "./socket.js"; 

dotenv.config({
  path: "./.env",
});

// connectDB()
//   .then(() => {
//     app.listen(process.env.PORT || 8060, () => {
//       console.log(`⚙️ 🏍️ 🚀...Server is running at port : ${process.env.PORT}`);
//     });
//   })
//   .catch((err) => {
//     console.log("MONGO db connection failed !!! ", err);
//   });

connectDB().then(() => {
  const server = http.createServer(app);

  initSocket(server); // ✅ This must run before any emit

  const PORT = process.env.PORT || 8060;
  server.listen(PORT, () => {
    console.log(`🚀 Server + Socket.IO running on port http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("❌ MongoDB connection failed:", err);
});
