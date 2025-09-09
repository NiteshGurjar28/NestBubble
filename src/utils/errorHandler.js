import { ApiError } from "./ApiError.js";
export const errorHandler = (err, req, res) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  return res.status(status).json(new ApiError(status, null, message));
};
