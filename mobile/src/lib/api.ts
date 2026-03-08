// FastAPI backend client for mobile app

export async function apiCall(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const API_BASE = __DEV__
    ? 'http://localhost:8000'
    : 'https://code-puppy-api.fly.dev';
  
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function sendMessage(prompt: string): Promise<{
  response: string;
  content?: string;
  usage?: any;
}> {
  try {
    const response = await apiCall('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: prompt }),
    });
    return response;
  } catch (error) {
    console.error('Failed to send message:', error);
    throw error;
  }
}

export async function checkHealth(): Promise<{ status: string }> {
  return apiCall('/api/health', { method: 'GET' });
}
