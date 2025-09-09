# Uber Integration Setup Guide

## Environment Variables Required

Add the following environment variables to your `.env` file:

```env
# Uber API Configuration
UBER_CLIENT_ID=your-uber-client-id
UBER_CLIENT_SECRET=your-uber-client-secret
# Server token deprecated; not required
UBER_SANDBOX=true
```

## How to Get Uber API Credentials

1. **Visit Uber Developer Portal**: Go to [https://developer.uber.com/](https://developer.uber.com/)

2. **Create an Account**: Sign up or log in to your Uber developer account

3. **Create a New App**:
   - Click "Create an App"
   - Fill in the required information:
     - App Name: Your app name
     - Description: Brief description of your app
     - Redirect URI: Your app's redirect URI (for OAuth)

4. **Get Your Credentials**:
   - **Client ID**: Found in your app dashboard
   - **Client Secret**: Found in your app dashboard
   - **Server Token**: Generate this in the "Server Token" section

5. **Configure Scopes**: Make sure to enable the following scopes:
   - `request`
   - `profile`
   - `history`
   - `places`

## API Endpoints

### Guest Endpoints (All require JWT authentication)

#### 1. Get Available Products
```
GET /api/guest/uber/products?latitude=28.6139&longitude=77.2090
```

#### 2. Get Price Estimates
```
GET /api/guest/uber/price-estimates?startLatitude=28.6139&startLongitude=77.2090&endLatitude=28.5355&endLongitude=77.3910
```

#### 3. Get Time Estimates
```
GET /api/guest/uber/time-estimates?latitude=28.6139&longitude=77.2090&productId=optional
```

#### 4. Request a Ride
```
POST /api/guest/uber/request-ride
Content-Type: application/json

{
  "productId": "product-id-from-products-endpoint",
  "pickupLocation": {
    "address": "Pickup Address",
    "coordinates": {
      "latitude": 28.6139,
      "longitude": 77.2090
    }
  },
  "dropoffLocation": {
    "address": "Dropoff Address", 
    "coordinates": {
      "latitude": 28.5355,
      "longitude": 77.3910
    }
  },
  "fareId": "optional-fare-id",
  "paymentMethodId": "optional-payment-method-id",
  "notes": "Optional notes",
  "specialRequests": ["wheelchair_accessible"]
}
```

#### 5. Get Ride Details
```
GET /api/guest/uber/ride-details/:bookingId
```

#### 6. Cancel Ride
```
POST /api/guest/uber/cancel-ride/:bookingId
Content-Type: application/json

{
  "cancellationReason": "Change of plans"
}
```

#### 7. Get Ride History
```
GET /api/guest/uber/ride-history?page=1&limit=10&status=completed
```

#### 8. Get Ride Receipt
```
GET /api/guest/uber/ride-receipt/:bookingId
```

### Webhook Endpoint (No authentication required)

#### Update Ride Status
```
POST /api/guest/uber/webhook/update-status
Content-Type: application/json

{
  "request_id": "uber-request-id",
  "status": "accepted",
  "driver": {
    "driver_id": "driver-id",
    "name": "Driver Name",
    "phone_number": "+1234567890",
    "rating": 4.8,
    "location": {
      "latitude": 28.6139,
      "longitude": 77.2090
    },
    "eta": 300
  },
  "vehicle": {
    "make": "Toyota",
    "model": "Camry",
    "license_plate": "ABC123",
    "color": "White"
  },
  "trip": {
    "start_time": "2024-01-01T10:00:00Z",
    "end_time": "2024-01-01T10:30:00Z",
    "duration": 1800,
    "distance": 5000,
    "fare": {
      "amount": 150,
      "currency_code": "INR"
    },
    "surge_multiplier": 1.0
  }
}
```

## Response Examples

### Successful Ride Request Response
```json
{
  "statusCode": 201,
  "data": {
    "booking": {
      "_id": "booking-id",
      "bookingId": "UB000001",
      "guestId": "user-id",
      "uberRequestId": "uber-request-id",
      "status": "processing",
      "pickupLocation": {
        "address": "Pickup Address",
        "coordinates": {
          "latitude": 28.6139,
          "longitude": 77.2090
        }
      },
      "dropoffLocation": {
        "address": "Dropoff Address",
        "coordinates": {
          "latitude": 28.5355,
          "longitude": 77.3910
        }
      },
      "rideDetails": {
        "productName": "UberX",
        "capacity": 4,
        "durationEstimate": 300
      }
    },
    "uberRequestId": "uber-request-id",
    "status": "processing",
    "eta": 300
  },
  "message": "Ride requested successfully",
  "success": true
}
```

### Available Products Response
```json
{
  "statusCode": 200,
  "data": [
    {
      "productId": "product-id-1",
      "displayName": "UberX",
      "description": "Affordable rides for up to 4 people",
      "capacity": 4,
      "image": "https://d1a3f4spazzrp4.cloudfront.net/car-types/mono/mono-uberx.png",
      "shared": false,
      "upfrontFareEnabled": true
    }
  ],
  "message": "Available ride options fetched successfully",
  "success": true
}
```

## Error Handling

The API returns standard error responses with appropriate HTTP status codes:

- `400 Bad Request`: Invalid input parameters
- `401 Unauthorized`: Missing or invalid JWT token
- `403 Forbidden`: User doesn't have guest role
- `404 Not Found`: Booking or resource not found
- `500 Internal Server Error`: Server or Uber API error

## Testing

1. **Sandbox Mode**: Set `UBER_SANDBOX=true` for testing (affects estimates only)
2. **Use Test Coordinates**: Use coordinates from Uber's test locations
3. **Mock Responses**: The service includes error handling for Uber API failures

## Security Notes

1. **Server Token**: Use server token for server-to-server API calls
2. **Client Credentials**: Keep client ID and secret secure
3. **Webhook Security**: Implement webhook signature verification in production
4. **Rate Limiting**: Implement rate limiting for API endpoints

## Production Considerations

1. **Webhook URL**: Configure webhook URL in Uber dashboard
2. **SSL Certificate**: Ensure HTTPS for webhook endpoint
3. **Error Monitoring**: Implement proper error logging and monitoring
4. **Database Indexing**: Ensure proper database indexes for performance
