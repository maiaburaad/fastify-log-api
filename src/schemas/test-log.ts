import { validateLogEntry } from "./log.js";

const validLog = {
    timestamp: new Date().toISOString(),
    level: "error",
    service: "checkout",
    message: "payment declined",
    attributes: {
        user_id: "42",
        region: "eu-west",
        retries: 3,
        cached: false
    }
};

const invalidLevelLog = {
    timestamp: new Date().toISOString(),
    level: "critical",
    service: "checkout",
    message: "payment declined"
};

const nestedAttributesLog = {
    timestamp: new Date().toISOString(),
    level: "error",
    service: "checkout",
    message: "payment declined",
    attributes: {
        user: {
            id: "42"
        }
    }
};

console.log("Valid log:");
console.log(validateLogEntry(validLog));

console.log("\nInvalid level:");
console.log(validateLogEntry(invalidLevelLog));

console.log("\nNested attributes:");
console.log(validateLogEntry(nestedAttributesLog));