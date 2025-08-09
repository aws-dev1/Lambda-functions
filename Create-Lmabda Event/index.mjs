import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const BUCKET = "event-assets-store"; 
const TABLE = "Events"; 

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));
  try {
    let rawBody = event.body;
    if (!rawBody && event.title) {
      rawBody = JSON.stringify(event);
    }
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    const eventId = uuidv4();
    const createdAt = Date.now();
    
    console.log("Parsed body. Generating event:", eventId);
    
    // Upload event logo if provided
    let eventLogoUrl = '';
    if (body.eventLogo) {
      eventLogoUrl = await uploadImage(body.eventLogo, `logos/${eventId}_logo.jpg`);
    }
    
    // Upload hero background image if provided
    let heroImageUrl = '';
    if (body.heroImage) {
      heroImageUrl = await uploadImage(body.heroImage, `heroes/${eventId}_hero.jpg`);
    }
    
    // Upload footer logo if provided
    let footerLogoUrl = '';
    if (body.footerLogo) {
      footerLogoUrl = await uploadImage(body.footerLogo, `footers/${eventId}_footer.jpg`);
    }
    
    // Process speakers with image uploads
    const speakers = await Promise.all((body.speakers || []).map(async (speaker, i) => {
      let photoUrl = '';
      if (speaker.photo) {
        photoUrl = await uploadImage(speaker.photo, `speakers/${eventId}_speaker_${i}.jpg`);
      }
      
      return {
        M: {
          name: { S: speaker.name || '' },
          role: { S: speaker.role || '' },
          topic: { S: speaker.topic || '' },
          photo: { S: photoUrl },
          featured: { BOOL: speaker.featured || false }
        }
      };
    }));
    
    // Process sponsors/partners with logo uploads
    const sponsors = await Promise.all((body.sponsors || []).map(async (sponsor, i) => {
      let logoUrl = '';
      if (sponsor.logo) {
        logoUrl = await uploadImage(sponsor.logo, `sponsors/${eventId}_sponsor_${i}.jpg`);
      }
      
      return {
        M: {
          name: { S: sponsor.name || '' },
          logo: { S: logoUrl },
          website: { S: sponsor.website || '' },
          tier: { S: sponsor.tier || 'silver' }
        }
      };
    }));
    
    // Process gallery items with media uploads
    const galleryItems = await Promise.all((body.galleryItems || []).map(async (item, i) => {
      let mediaUrl = '';
      if (item.src) {
        const extension = item.type === 'video' ? 'mp4' : 'jpg';
        mediaUrl = await uploadImage(item.src, `gallery/${eventId}_gallery_${i}.${extension}`);
      }
      
      return {
        M: {
          type: { S: item.type || 'image' },
          src: { S: mediaUrl },
          title: { S: item.title || '' },
          category: { S: item.category || 'Event' }
        }
      };
    }));
    
    // Build comprehensive DynamoDB item
    const item = {
      // Primary identifiers
      eventId: { S: eventId },
      createdAt: { N: createdAt.toString() },
      
      // Template selection
      selectedTemplate: { S: body.selectedTemplate || '1' },
      
      // Event header information
      eventName: { S: body.eventName || '' },
      eventDate: { S: body.eventDate || '' },
      eventTime: { S: body.eventTime || '' },
      venue: { S: body.venue || '' },
      eventLogo: { S: eventLogoUrl },
      heroImage: { S: heroImageUrl },
      showCountdown: { BOOL: body.showCountdown !== undefined ? body.showCountdown : true },
      
      // CTAs
      primaryCTA: {
        M: {
          text: { S: body.primaryCTA?.text || 'Register Now' },
          link: { S: body.primaryCTA?.link || '#contact' }
        }
      },
      secondaryCTA: {
        M: {
          text: { S: body.secondaryCTA?.text || 'View Agenda' },
          link: { S: body.secondaryCTA?.link || '#agenda' }
        }
      },
      
      // About section
      aboutTitle: { S: body.aboutTitle || 'About the Event' },
      description: { S: body.description || '' },
      videoEmbedUrl: { S: body.videoEmbedUrl || '' },
      objectives: {
        L: (body.objectives || []).map(obj => ({ S: obj }))
      },
      
      // Speakers
      speakers: { L: speakers },
      
      // Agenda
      agenda: {
        L: (body.agenda || []).map(session => ({
          M: {
            day: { N: (session.day || 1).toString() },
            time: { S: session.time || '' },
            title: { S: session.title || '' },
            speaker: { S: session.speaker || '' },
            location: { S: session.location || '' },
            type: { S: session.type || 'session' },
            duration: { S: session.duration || '1 hour' }
          }
        }))
      },
      
      // Event highlights (Template 2)
      highlights: {
        L: (body.highlights || []).map(highlight => ({
          M: {
            icon: { S: highlight.icon || 'zap' },
            title: { S: highlight.title || '' },
            description: { S: highlight.description || '' }
          }
        }))
      },
      
      // Sponsors/Partners
      sponsors: { L: sponsors },
      
      // Gallery
      galleryItems: { L: galleryItems },
      
      // Contact and registration
      email: { S: body.email || '' },
      phone: { S: body.phone || '' },
      mapEmbedUrl: { S: body.mapEmbedUrl || '' },
      contactFormMessage: { S: body.contactFormMessage || 'Ready to join us? Register now or get in touch for more information.' },
      
      // Social links
      socialLinks: {
        M: {
          facebook: { S: body.socialLinks?.facebook || '' },
          twitter: { S: body.socialLinks?.twitter || '' },
          instagram: { S: body.socialLinks?.instagram || '' },
          linkedin: { S: body.socialLinks?.linkedin || '' },
          youtube: { S: body.socialLinks?.youtube || '' }
        }
      },
      
      // Footer
      footerLogo: { S: footerLogoUrl },
      footerNavLinks: {
        L: (body.footerNavLinks || []).map(link => ({
          M: {
            label: { S: link.label || '' },
            link: { S: link.link || '' }
          }
        }))
      },
      
      // Metadata for queries and management
      status: { S: 'active' },
      updatedAt: { N: createdAt.toString() }
    };
    
    // Store in DynamoDB
    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: item
    }));
    
    console.log("Event stored in DynamoDB:", eventId);
    
    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE"
      },
      body: JSON.stringify({ 
        message: "Event created successfully", 
        eventId,
        eventUrl: `/event/${eventId}`,
        previewUrl: `/preview/event-template-${body.selectedTemplate}?eventId=${eventId}`
      })
    };
    
  } catch (err) {
    console.error("Error while creating event:", {
      message: err.message,
      stack: err.stack
    });
    
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE"
      },
      body: JSON.stringify({ 
        error: "Failed to create event", 
        detail: err.message 
      })
    };
  }
};

/**
 * Upload base64 image data to S3
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} key - S3 object key
 * @returns {Promise<string>} - S3 URL of uploaded image
 */
async function uploadImage(base64Data, key) {
  try {
    if (!base64Data) return '';
    
    // Extract base64 content and determine content type
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 format');
    }
    
    const contentType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');
    
    // Determine file extension based on content type
    const extension = contentType.includes('png') ? 'png' : 
                     contentType.includes('gif') ? 'gif' :
                     contentType.includes('webp') ? 'webp' : 'jpg';
    
    // Update key with correct extension
    const keyWithExtension = key.replace(/\.(jpg|png|gif|webp|mp4)$/, `.${extension}`);
    
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: keyWithExtension,
      Body: buffer,
      ContentType: contentType,
      // Add cache control for better performance
      CacheControl: 'max-age=31536000', // 1 year
      // Make images publicly readable
      ACL: 'public-read'
    });
    
    await s3.send(command);
    
    const imageUrl = `https://${BUCKET}.s3.amazonaws.com/${keyWithExtension}`;
    console.log(`Image uploaded successfully: ${imageUrl}`);
    
    return imageUrl;
    
  } catch (error) {
    console.error(`Failed to upload image with key ${key}:`, error);
    // Return empty string rather than throwing to prevent entire event creation from failing
    return '';
  }
}

/**
 * Helper function to validate required fields
 * @param {Object} body - Request body
 * @throws {Error} - If required fields are missing
 */
function validateEventData(body) {
  const requiredFields = ['eventName', 'eventDate', 'selectedTemplate'];
  const missingFields = requiredFields.filter(field => !body[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  // Validate template selection
  if (!['1', '2'].includes(body.selectedTemplate)) {
    throw new Error('Invalid template selection. Must be "1" or "2"');
  }
  
  // Validate date format
  if (body.eventDate && !isValidDate(body.eventDate)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD');
  }
}

/**
 * Validate date format
 * @param {string} dateString - Date string to validate
 * @returns {boolean} - True if valid date
 */
function isValidDate(dateString) {
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && dateString.match(/^\d{4}-\d{2}-\d{2}$/);
}
