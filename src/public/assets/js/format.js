
function formatPrice(value, options = {}) {
  try {
        const { decimals = 2 } = options;
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
        return "N/A";
        }
        const formatter = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        });
        return formatter.format(numValue);
    } catch (error) {
        console.error("Error formatting price:", error);
        return "N/A";
    }
}


function formatDate(value, options = {}) {
  try {
        const { format = "medium", customFormat = { day: "2-digit", month: "2-digit", year: "numeric" } } = options;
        const dateValue = new Date(value);
        if (isNaN(dateValue.getTime())) {
            return "Invalid Date";
        }
        const dateFormats = {
            short: { day: "2-digit", month: "2-digit", year: "numeric" }, // 03/09/2025
            medium: { day: "2-digit", month: "short", year: "numeric" }, // 03 Sep 2025
            long: { day: "numeric", month: "long", year: "numeric" }, // 3 September 2025
            full: { day: "numeric", month: "short", year: "numeric", weekday: "short" }, // Wednesday, 3 September 2025
            compact: { day: "2-digit", month: "2-digit", year: "2-digit" }, // 03/09/25
        };
        const selectedFormat = format === "custom" ? customFormat : dateFormats[format] || dateFormats.short;
        return new Intl.DateTimeFormat("en-IN", selectedFormat).format(dateValue);
    } catch (error) {
        console.error("Error formatting date:", error);
        return "N/A";
    }
}


function formatDateTime(value, options = {}) {
  try {
        const { format = "medium", customFormat = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true } } = options;
        const dateValue = new Date(value);
            if (isNaN(dateValue.getTime())) {
            return "Invalid Date";
        }
        const dateTimeFormats = {
            medium: { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }, // 15 Jul 2025, 12:02 pm
            full: { day: "numeric", month: "long", year: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }, // Wednesday, 15 July 2025, 12:02:00 pm
        };
        const selectedFormat = format === "custom" ? customFormat : dateTimeFormats[format] || dateTimeFormats.medium;
        return new Intl.DateTimeFormat("en-IN", selectedFormat).format(dateValue);
    } catch (error) {
        console.error("Error formatting date:", error);
        return "N/A";
    }
}
