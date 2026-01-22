class yogile {
    constructor(apiKey) {
        this.baseUrl = 'https://ru.yougile.com/api-v2';
        this.apiKey = apiKey;
    }

    async getTask(taskID) {
        const response = await fetch(`${this.baseUrl}/tasks/${taskID}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Error fetching task: ${response.statusText}`);
        }

        return response.json();
    }

    async getTaskChat(taskID, offset, limit) {
        const response = await fetch(`${this.baseUrl}/chats/${taskID}/messages?offset=${offset}&limit=${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Error fetching task chat: ${response.statusText}`);
        }

        return (await response.json()).content;
    }
}

module.exports = yogile;