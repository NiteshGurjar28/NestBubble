import axios from "axios";

class UberService {
  constructor() {
    this.baseURL = "https://api.uber.com/v1.2";
    this.sandboxURL = "https://sandbox-api.uber.com/v1.2";

    // Server token is deprecated; not used
    this.serverToken = undefined;
    this.isSandbox = process.env.UBER_SANDBOX === "true";

    this.apiURL = this.isSandbox ? this.sandboxURL : this.baseURL;
    
    // Initialize axios instance
    this.api = axios.create({
      baseURL: this.apiURL,
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en_US",
        "Accept": "application/json",
      },
    });

    // Add request interceptor for authentication
    this.api.interceptors.request.use((config) => config);
  }

  get clientId() {
    return process.env.UBER_CLIENT_ID;
  }

  get clientSecret() {
    return process.env.UBER_CLIENT_SECRET;
  }

  get redirectUri() {
    return process.env.UBER_REDIRECT_URI;
  }

  /**
   * Build Uber OAuth authorize URL for user consent
   */
  buildAuthorizeUrl(state = "") {
    if (!this.clientId || !this.redirectUri) {
      const missing = [];
      if (!this.clientId) missing.push("UBER_CLIENT_ID");
      if (!this.redirectUri) missing.push("UBER_REDIRECT_URI");
      const err = new Error(`Missing Uber OAuth config: ${missing.join(", ")}`);
      err.code = "UBER_OAUTH_CONFIG_MISSING";
      throw err;
    }

    const params = new URLSearchParams();
    params.set("client_id", this.clientId);
    params.set("response_type", "code");
    params.set("scope", "profile history places request request_receipt");
    params.set("redirect_uri", this.redirectUri);
    if (state) params.set("state", state);
    return `https://login.uber.com/oauth/v2/authorize?${params.toString()}`;
  }

  /**
   * Exchange auth code for access/refresh tokens
   */
  async exchangeCodeForTokens(code) {
    const url = "https://login.uber.com/oauth/v2/token";
    const body = new URLSearchParams();
    body.set("client_id", this.clientId || "");
    body.set("client_secret", this.clientSecret || "");
    body.set("grant_type", "authorization_code");
    body.set("redirect_uri", this.redirectUri || "");
    body.set("code", code);
    const resp = await axios.post(url, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return resp.data; // { access_token, refresh_token, expires_in, scope, token_type }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken) {
    const url = "https://login.uber.com/oauth/v2/token";
    const body = new URLSearchParams();
    body.set("client_id", this.clientId || "");
    body.set("client_secret", this.clientSecret || "");
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    const resp = await axios.post(url, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return resp.data; // { access_token, refresh_token, expires_in, scope, token_type }
  }

  /**
   * Call Uber API with user access token, with simple error handling
   */
  async callWithUserToken(path, accessToken) {
    const resp = await axios.get(`${this.apiURL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return resp.data;
  }

  /**
   * Get available products (ride types) for a location
   * @param {number} latitude - Pickup latitude
   * @param {number} longitude - Pickup longitude
   * @returns {Promise<Array>} Available products
   */
  async getProducts(latitude, longitude) {
    try {
      const response = await this.api.get("/products", {
        params: {
          latitude,
          longitude,
        },
      });
      return response.data.products;
    } catch (error) {
      console.error("Error fetching Uber products:", error.response?.data || error.message);
      throw new Error("Failed to fetch available ride options");
    }
  }

  /**
   * Get price estimates for a ride
   * @param {number} startLatitude - Start latitude
   * @param {number} startLongitude - Start longitude
   * @param {number} endLatitude - End latitude
   * @param {number} endLongitude - End longitude
   * @returns {Promise<Array>} Price estimates
   */
  async getPriceEstimates(startLatitude, startLongitude, endLatitude, endLongitude) {
    try {
      const response = await this.api.get("/estimates/price", {
        params: {
          start_latitude: startLatitude,
          start_longitude: startLongitude,
          end_latitude: endLatitude,
          end_longitude: endLongitude,
        },
      });
      return response.data.prices;
    } catch (error) {
      console.error("Error fetching price estimates:", error.response?.data || error.message);
      throw new Error("Failed to fetch price estimates");
    }
  }

  /**
   * Get time estimates for pickup
   * @param {number} latitude - Pickup latitude
   * @param {number} longitude - Pickup longitude
   * @param {string} productId - Product ID (optional)
   * @returns {Promise<Array>} Time estimates
   */
  async getTimeEstimates(latitude, longitude, productId = null) {
    try {
      const params = {
        start_latitude: latitude,
        start_longitude: longitude,
      };
      
      if (productId) {
        params.product_id = productId;
      }

      const response = await this.api.get("/estimates/time", {
        params,
      });
      return response.data.times;
    } catch (error) {
      console.error("Error fetching time estimates:", error.response?.data || error.message);
      throw new Error("Failed to fetch time estimates");
    }
  }

  /**
   * Request a ride
   * @param {Object} rideRequest - Ride request details
   * @returns {Promise<Object>} Ride request response
   */
  async requestRide(rideRequest) {
    // Without a user OAuth token we cannot call /requests.
    // Use deeplink flow instead. This method now returns a deeplink URL.
    const {
      productId,
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      pickupAddress,
      dropoffAddress,
    } = rideRequest;

    return this.generateDeeplink({
      productId,
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      pickupAddress,
      dropoffAddress,
    });
  }

  /**
   * Get ride details
   * @param {string} requestId - Uber request ID
   * @returns {Promise<Object>} Ride details
   */
  async getRideDetails(requestId) {
    throw new Error("Ride details require user OAuth; not available without user token");
  }

  /**
   * Cancel a ride request
   * @param {string} requestId - Uber request ID
   * @returns {Promise<Object>} Cancellation response
   */
  async cancelRide(requestId) {
    throw new Error("Ride cancellation requires user OAuth; not available without user token");
  }

  /**
   * Get ride receipt
   * @param {string} requestId - Uber request ID
   * @returns {Promise<Object>} Ride receipt
   */
  async getRideReceipt(requestId) {
    throw new Error("Ride receipt requires user OAuth; not available without user token");
  }

  /**
   * Get user profile
   * @param {string} accessToken - User access token
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(accessToken) {
    try {
      const response = await axios.get(`${this.apiURL}/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching user profile:", error.response?.data || error.message);
      throw new Error("Failed to fetch user profile");
    }
  }

  /**
   * Get user's ride history
   * @param {string} accessToken - User access token
   * @param {number} limit - Number of rides to fetch
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Object>} Ride history
   */
  async getUserRideHistory(accessToken, limit = 50, offset = 0) {
    try {
      const response = await axios.get(`${this.apiURL}/history`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        params: {
          limit,
          offset,
        },
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching ride history:", error.response?.data || error.message);
      throw new Error("Failed to fetch ride history");
    }
  }

  /**
   * Validate coordinates
   * @param {number} latitude - Latitude
   * @param {number} longitude - Longitude
   * @returns {boolean} Whether coordinates are valid
   */
  validateCoordinates(latitude, longitude) {
    return (
      typeof latitude === "number" &&
      typeof longitude === "number" &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   * @param {number} lat1 - First latitude
   * @param {number} lon1 - First longitude
   * @param {number} lat2 - Second latitude
   * @param {number} lon2 - Second longitude
   * @returns {number} Distance in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   * @param {number} degrees - Degrees
   * @returns {number} Radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Format price estimate for display
   * @param {Object} priceEstimate - Price estimate object
   * @returns {Object} Formatted price estimate
   */
  formatPriceEstimate(priceEstimate) {
    return {
      productId: priceEstimate.product_id,
      displayName: priceEstimate.display_name,
      estimate: priceEstimate.estimate,
      lowEstimate: priceEstimate.low_estimate,
      highEstimate: priceEstimate.high_estimate,
      currency: priceEstimate.currency_code,
      duration: priceEstimate.duration,
      distance: priceEstimate.distance,
    };
  }

  /**
   * Format time estimate for display
   * @param {Object} timeEstimate - Time estimate object
   * @returns {Object} Formatted time estimate
   */
  formatTimeEstimate(timeEstimate) {
    return {
      productId: timeEstimate.product_id,
      displayName: timeEstimate.display_name,
      estimate: timeEstimate.estimate,
    };
  }

  /**
   * Generate Uber Deeplink URL for requesting a ride via app/web
   * Reference: https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links
   */
  generateDeeplink({
    productId,
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude,
    pickupAddress,
    dropoffAddress,
  }) {
    const clientId = this.clientId;
    const base = "https://m.uber.com/ul/";
    const params = new URLSearchParams();
    params.set("client_id", clientId || "");
    params.set("action", "setPickup");
    params.set("pickup[latitude]", String(startLatitude));
    params.set("pickup[longitude]", String(startLongitude));
    if (pickupAddress) params.set("pickup[nickname]", pickupAddress);
    if (endLatitude != null && endLongitude != null) {
      params.set("dropoff[latitude]", String(endLatitude));
      params.set("dropoff[longitude]", String(endLongitude));
      if (dropoffAddress) params.set("dropoff[nickname]", dropoffAddress);
    }
    if (productId) params.set("product_id", productId);

    return `${base}?${params.toString()}`;
  }
}

// Create singleton instance
const uberService = new UberService();

export default uberService;
