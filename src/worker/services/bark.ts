export async function sendBarkNotification(barkUrl: string, title: string, body: string, linkUrl?: string): Promise<{ success: boolean, payload?: string }> {
  if (!barkUrl) {
    console.warn('Bark URL is not configured.');
    return { success: false };
  }

  let endpoint = '';
  try {
    // barkUrl should ideally be the base URL with key, e.g., https://api.day.app/YOUR_KEY/
    // Ensure it ends with a slash
    const baseUrl = barkUrl.endsWith('/') ? barkUrl : `${barkUrl}/`;

    // Construct the endpoint URL safely encoding title and body
    endpoint = `${baseUrl}${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
    if (linkUrl) {
      endpoint += `?url=${encodeURIComponent(linkUrl)}`;
    }

    const response = await fetch(endpoint, {
      method: 'GET',
    });

    if (response.ok) {
      return { success: true, payload: endpoint };
    } else {
      console.error(`Bark notification failed with status: ${response.status}`);
      return { success: false, payload: endpoint };
    }
  } catch (error) {
    console.error('Error sending Bark notification:', error);
    return { success: false, payload: endpoint };
  }
}
