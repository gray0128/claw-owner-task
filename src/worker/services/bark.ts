export async function sendBarkNotification(barkUrl: string, title: string, body: string): Promise<boolean> {
  if (!barkUrl) {
    console.warn('Bark URL is not configured.');
    return false;
  }

  try {
    // barkUrl should ideally be the base URL with key, e.g., https://api.day.app/YOUR_KEY/
    // Ensure it ends with a slash
    const baseUrl = barkUrl.endsWith('/') ? barkUrl : `${barkUrl}/`;
    
    // Construct the endpoint URL safely encoding title and body
    const endpoint = `${baseUrl}${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    
    const response = await fetch(endpoint, {
      method: 'GET',
    });

    if (response.ok) {
      return true;
    } else {
      console.error(`Bark notification failed with status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error('Error sending Bark notification:', error);
    return false;
  }
}
