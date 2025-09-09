class ApiResponse {
    constructor(code, data, message = "Success"){
        this.status = code < 400
        this.code = code
        this.message = message
        this.data = data
    }
}

export { ApiResponse }