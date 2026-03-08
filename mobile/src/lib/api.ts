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
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export interface ChatResponse {
  message: string;
  raw?: any;
  usage?: any;
  model?: string;
}

export async function sendMessage(prompt: string): Promise<ChatResponse> {
  try {
    const response: ChatResponse = await apiCall('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
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
