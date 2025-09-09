// Uber Integration Test Examples
// This file contains example API calls for testing the Uber integration

// Example 1: Get Available Products
const getAvailableProductsExample = {
  method: 'GET',
  url: '/api/guest/uber/products',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  params: {
    latitude: 28.6139,  // Delhi coordinates
    longitude: 77.2090
  }
};

// Example 2: Get Price Estimates
const getPriceEstimatesExample = {
  method: 'GET',
  url: '/api/guest/uber/price-estimates',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  params: {
    startLatitude: 28.6139,   // Delhi
    startLongitude: 77.2090,
    endLatitude: 28.5355,     // Gurgaon
    endLongitude: 77.3910
  }
};

// Example 3: Get Time Estimates
const getTimeEstimatesExample = {
  method: 'GET',
  url: '/api/guest/uber/time-estimates',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  params: {
    latitude: 28.6139,
    longitude: 77.2090,
    productId: 'optional-product-id'
  }
};

// Example 4: Request a Ride (returns deeplink; open in browser)
const requestRideExample = {
  method: 'POST',
  url: '/api/guest/uber/request-ride',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  data: {
    productId: 'product-id-from-products-endpoint',
    pickupLocation: {
      address: 'Connaught Place, New Delhi',
      coordinates: {
        latitude: 28.6139,
        longitude: 77.2090
      }
    },
    dropoffLocation: {
      address: 'Cyber City, Gurgaon',
      coordinates: {
        latitude: 28.5355,
        longitude: 77.3910
      }
    },
    notes: 'Please call when you arrive',
    specialRequests: ['wheelchair_accessible']
  }
};

// Example 5: Get Ride Details (returns stored info and deeplink)
const getRideDetailsExample = {
  method: 'GET',
  url: '/api/guest/uber/ride-details/BOOKING_ID',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  }
};

// Example 6: Cancel Ride
const cancelRideExample = {
  method: 'POST',
  url: '/api/guest/uber/cancel-ride/BOOKING_ID',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  data: {
    cancellationReason: 'Change of plans'
  }
};

// Example 7: Get Ride History
const getRideHistoryExample = {
  method: 'GET',
  url: '/api/guest/uber/ride-history',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  params: {
    page: 1,
    limit: 10,
    status: 'completed',
    sortBy: 'createdAt',
    sortOrder: 'desc'
  }
};

// Example 8: Get Ride Receipt
const getRideReceiptExample = {
  method: 'GET',
  url: '/api/guest/uber/ride-receipt/BOOKING_ID',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  }
};

// Example 9: Webhook Update (Uber calls this)
const webhookUpdateExample = {
  method: 'POST',
  url: '/api/guest/uber/webhook/update-status',
  headers: {
    'Content-Type': 'application/json'
  },
  data: {
    request_id: 'uber-request-id',
    status: 'accepted',
    driver: {
      driver_id: 'driver-id',
      name: 'Rajesh Kumar',
      phone_number: '+919876543210',
      rating: 4.8,
      location: {
        latitude: 28.6139,
        longitude: 77.2090
      },
      eta: 300
    },
    vehicle: {
      make: 'Toyota',
      model: 'Camry',
      license_plate: 'DL01AB1234',
      color: 'White'
    }
  }
};

// Using with Axios (Node.js)
const axios = require('axios');

async function testUberIntegration() {
  const baseURL = 'http://localhost:3000';
  const token = 'YOUR_JWT_TOKEN';
  
  try {
    // 1. Get available products
    console.log('Getting available products...');
    const products = await axios.get(`${baseURL}/api/guest/uber/products`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { latitude: 28.6139, longitude: 77.2090 }
    });
    console.log('Available products:', products.data);

    // 2. Get price estimates
    console.log('Getting price estimates...');
    const prices = await axios.get(`${baseURL}/api/guest/uber/price-estimates`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        startLatitude: 28.6139,
        startLongitude: 77.2090,
        endLatitude: 28.5355,
        endLongitude: 77.3910
      }
    });
    console.log('Price estimates:', prices.data);

    // 3. Request a ride (if you have a valid product ID)
    if (products.data.data && products.data.data.length > 0) {
      console.log('Requesting ride...');
      const rideRequest = await axios.post(`${baseURL}/api/guest/uber/request-ride`, {
        productId: products.data.data[0].productId,
        pickupLocation: {
          address: 'Connaught Place, New Delhi',
          coordinates: { latitude: 28.6139, longitude: 77.2090 }
        },
        dropoffLocation: {
          address: 'Cyber City, Gurgaon',
          coordinates: { latitude: 28.5355, longitude: 77.3910 }
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Ride requested:', rideRequest.data);
    }

  } catch (error) {
    console.error('Error testing Uber integration:', error.response?.data || error.message);
  }
}

// Using with Fetch (Browser)
async function testUberIntegrationBrowser() {
  const baseURL = 'http://localhost:3000';
  const token = 'YOUR_JWT_TOKEN';
  
  try {
    // Get available products
    const response = await fetch(`${baseURL}/api/guest/uber/products?latitude=28.6139&longitude=77.2090`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const products = await response.json();
    console.log('Available products:', products);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Export examples for use in other files
module.exports = {
  getAvailableProductsExample,
  getPriceEstimatesExample,
  getTimeEstimatesExample,
  requestRideExample,
  getRideDetailsExample,
  cancelRideExample,
  getRideHistoryExample,
  getRideReceiptExample,
  webhookUpdateExample,
  testUberIntegration,
  testUberIntegrationBrowser
};
