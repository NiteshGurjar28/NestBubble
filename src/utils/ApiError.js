class ApiError extends Error {
  constructor(
    code = 500,
    message = "Something went wrong",
    errors = [],
    stack = ""
  ) {
    super(message);

    this.status = false;
    this.code = code;
    this.data = "Error";
    this.message = message;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      status: this.status,
      code: this.code,
      data: this.data,
      message: this.message,
      errors: this.errors,
    };
  }
}

export { ApiError };
