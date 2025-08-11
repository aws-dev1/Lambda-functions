import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";

// Optimized clients with timeout configurations
const s3 = new S3Client({ 
  region: process.env.AWS_REGION,
  requestHandler: {
    requestTimeout: 2000, // 2 second timeout for S3 operations
    connectionTimeout: 1000
  }
});

const dynamo = new DynamoDBClient({ 
  region: process.env.AWS_REGION,
  requestHandler: {
    requestTimeout: 1000, // 1 second timeout for DynamoDB
    connectionTimeout: 500
  }
});

const BUCKET = process.env.ASSETS_BUCKET || "event-assets-store";
const TABLE = process.env.EVENTS_TABLE || "Events";
const MAX_ASSET_SIZE = 1024 * 1024; // 1MB limit per asset
const UPLOAD_TIMEOUT = 2000; // 2 seconds per upload

export const handler = async (event) => {
  const startTime = Date.now();
  console.log("Function started at:", new Date().toISOString());

  try {
    // 1. Quick request validation (< 10ms)
    const parseResult = validateAndParseRequest(event);
    if (!parseResult.isValid) {
      return createResponse(400, { 
        error: "Invalid request format",
        detail: parseResult.error,
        processingTime: Date.now() - startTime
      });
    }

    // 2. Normalize and validate required fields (< 5ms)
    const normalizedBody = normalizeRequestBody(parseResult.body);
    const requiredFields = validateRequiredFields(normalizedBody);
    
    if (!requiredFields.isValid) {
      return createResponse(400, { 
        error: "Missing required fields",
        missingFields: requiredFields.missing,
        processingTime: Date.now() - startTime
      });
    }

    const eventId = uuidv4();
    const timestamp = Date.now();

    // 3. Fast asset processing with size limits and timeouts
    const assets = await processAssetsWithTimeout(normalizedBody, eventId);
    
    // 4. Quick database insert
    await createEventRecord({
      body: normalizedBody,
      eventId,
      timestamp,
      assets,
      originalEvent: event
    });

    const processingTime = Date.now() - startTime;
    console.log(`Successfully created event ${eventId} in ${processingTime}ms`);
    
    return createResponse(201, {
      message: "Event created successfully",
      eventId,
      eventUrl: `/event/${eventId}`,
      previewUrl: `/preview/event-template-${normalizedBody.selectedTemplate}?eventId=${eventId}`,
      processingTime,
      assetsProcessed: {
        main: assets.mainAssets || 0,
        speakers: assets.speakers?.length || 0,
        sponsors: assets.sponsors?.length || 0,
        gallery: assets.galleryItems?.length || 0
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("Function failed:", {
      error: error.message,
      processingTime,
      timeout: processingTime > 2800
    });

    return createResponse(error.statusCode || 500, {
      error: error.message.includes('timeout') ? "Processing timeout" : "Event creation failed",
      detail: error.message,
      processingTime,
      requestId: event.requestContext?.requestId
    });
  }
};

// =============== OPTIMIZED CORE FUNCTIONS ===============

async function processAssetsWithTimeout(body, eventId) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Asset processing timeout')), UPLOAD_TIMEOUT);
  });

  try {
    const assetsPromise = processAssetsQuickly(body, eventId);
    return await Promise.race([assetsPromise, timeoutPromise]);
  } catch (error) {
    console.error("Asset processing failed or timed out:", error);
    // Return minimal assets to allow event creation to continue
    return {
      eventLogo: "",
      heroImage: "",
      footerLogo: "",
      banner: "",
      speakers: [],
      sponsors: [],
      galleryItems: [],
      mainAssets: 0
    };
  }
}

async function processAssetsQuickly(body, eventId) {
  const results = {
    eventLogo: "",
    heroImage: "",
    footerLogo: "",
    banner: "",
    speakers: [],
    sponsors: [],
    galleryItems: [],
    mainAssets: 0
  };

  // Process only essential assets first (main banner/logo)
  const essentialAssets = [
    { data: body.bannerBase64 || body.heroImage, key: 'banner', path: `banners/${eventId}_banner` },
    { data: body.eventLogo, key: 'eventLogo', path: `banners/${eventId}_logo` }
  ].filter(asset => asset.data && validateAssetSize(asset.data));

  // Quick parallel upload of essential assets only
  const uploadPromises = essentialAssets.map(async (asset) => {
    try {
      const url = await uploadWithTimeout(asset.data, asset.path);
      results[asset.key] = url;
      if (url) results.mainAssets++;
    } catch (error) {
      console.error(`Failed to upload ${asset.key}:`, error.message);
      results[asset.key] = "";
    }
  });

  await Promise.allSettled(uploadPromises);

  // Process speakers/sponsors with minimal data (skip photos for now)
  results.speakers = (body.speakers || []).slice(0, 5).map(speaker => ({
    name: speaker?.name || "",
    role: speaker?.role || speaker?.designation || "",
    topic: speaker?.topic || "",
    url: "", // Skip photo uploads to save time
    featured: Boolean(speaker?.featured)
  }));

  results.sponsors = (body.sponsors || body.partners || []).slice(0, 10).map(sponsor => ({
    name: sponsor?.name || "",
    website: sponsor?.website || "",
    tier: sponsor?.tier || "silver",
    url: "" // Skip logo uploads to save time
  }));

  return results;
}

async function uploadWithTimeout(base64Data, keyPrefix) {
  if (!base64Data || !validateAssetSize(base64Data)) {
    return "";
  }

  const uploadTimeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Upload timeout')), 1500); // 1.5s per upload
  });

  try {
    const uploadPromise = uploadToS3Fast(base64Data, keyPrefix);
    return await Promise.race([uploadPromise, uploadTimeout]);
  } catch (error) {
    console.error(`Upload failed for ${keyPrefix}:`, error.message);
    return "";
  }
}

async function uploadToS3Fast(base64Data, keyPrefix) {
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 format");
  }

  const [, contentType, data] = match;
  const extension = contentType.split("/")[1] || "jpg";
  const key = `${keyPrefix}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: Buffer.from(data, "base64"),
    ContentType: contentType,
    CacheControl: "max-age=31536000"
  });

  await s3.send(command);
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

async function createEventRecord({ body, eventId, timestamp, assets, originalEvent }) {
  const dbItem = {
    eventId: { S: eventId },
    createdAt: { N: timestamp.toString() },
    updatedAt: { N: timestamp.toString() },
    status: { S: "active" },

    // Core event data
    selectedTemplate: { S: body.selectedTemplate || "classic" },
    eventName: { S: body.eventName || "" },
    eventDate: { S: body.eventDate || "" },
    eventTime: { S: body.eventTime || "" },
    venue: { S: body.venue || "" },
    description: { S: body.description || "" },
    
    // Essential assets only
    eventLogo: { S: assets.eventLogo || "" },
    heroImage: { S: assets.banner || assets.heroImage || "" },
    
    // Basic configurations
    showCountdown: { BOOL: body.showCountdown ?? true },
    
    // Simplified content sections
    aboutTitle: { S: body.aboutTitle || "About the Event" },
    videoEmbedUrl: { S: body.videoEmbedUrl || body.videos?.[0] || "" },
    
    // Speaker
    speakers: { 
      L: assets.speakers.slice(0, 5).map(s => ({
        M: {
          name: { S: s.name || "" },
          role: { S: s.role || "" },
          topic: { S: s.topic || "" },
          photo: { S: s.url || "" },
          featured: { BOOL: s.featured || false }
        }
      }))
    },

    // Sponsors 
    sponsors: {
      L: assets.sponsors.slice(0, 10).map(s => ({
        M: {
          name: { S: s.name || "" },
          logo: { S: s.url || "" },
          website: { S: s.website || "" },
          tier: { S: s.tier || "silver" }
        }
      }))
    },

    // Contact info
    contactOrganizer: { S: body.contact?.organizer || "" },
    contactEmail: { S: body.contact?.email || "" },
    contactWhatsapp: { S: body.contact?.whatsapp || "" },
    
    _version: { N: "1" },
    _processingMode: { S: "fast" }
  };

  const command = new PutItemCommand({
    TableName: TABLE,
    Item: dbItem,
    ConditionExpression: "attribute_not_exists(eventId)"
  });

  return await dynamo.send(command);
}

// HELPER FUNCTIONS

function validateAndParseRequest(event) {
  try {
    if (!event) return { isValid: false, error: "No event provided" };

    if (event.body) {
      const parsedBody = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      if (!parsedBody || typeof parsedBody !== 'object') {
        return { isValid: false, error: "Invalid JSON body" };
      }
      return { body: parsedBody, isValid: true };
    }
    
    if (typeof event === 'object') {
      return { body: event, isValid: true };
    }

    return { isValid: false, error: "Invalid request format" };
  } catch (error) {
    return { isValid: false, error: `Parsing error: ${error.message}` };
  }
}

function normalizeRequestBody(body) {
  return {
    eventName: body.eventName || body.title || "",
    eventDate: body.eventDate || body.date || "",
    selectedTemplate: body.selectedTemplate || body.template || "classic",
    eventTime: body.eventTime || body.time || "",
    venue: body.venue || "",
    description: body.description || "",
    aboutTitle: body.aboutTitle || "About the Event",
    showCountdown: body.showCountdown ?? true,
    
    // Assets
    bannerBase64: body.bannerBase64,
    eventLogo: body.eventLogo,
    heroImage: body.heroImage,
    
    // Collections
    speakers: Array.isArray(body.speakers) ? body.speakers.slice(0, 5) : [],
    sponsors: Array.isArray(body.sponsors) ? body.sponsors.slice(0, 10) : 
              Array.isArray(body.partners) ? body.partners.slice(0, 10) : [],
    videos: Array.isArray(body.videos) ? body.videos.slice(0, 1) : [],
    
    // Contact
    contact: body.contact || {},
    
    // Other
    videoEmbedUrl: body.videoEmbedUrl || body.videos?.[0] || ""
  };
}

function validateRequiredFields(body) {
  const required = ["eventName", "eventDate", "selectedTemplate"];
  const missing = required.filter(field => !body[field]?.toString().trim());
  return { missing, isValid: missing.length === 0 };
}

function validateAssetSize(base64Data) {
  if (!base64Data || typeof base64Data !== 'string') return false;
  
  const match = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return false;
  
  const dataSize = match[1].length * 0.75;
  if (dataSize > MAX_ASSET_SIZE) {
    console.warn(`Asset too large: ${Math.round(dataSize / 1024)}KB (max: ${MAX_ASSET_SIZE / 1024}KB)`);
    return false;
  }
  
  return true;
}

function createResponse(statusCode, body, headers = {}) {
  const defaultHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*", 
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
    "Content-Type": "application/json"
  };

  return {
    statusCode,
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify({
      ...body,
      timestamp: new Date().toISOString()
    })
  };
}
