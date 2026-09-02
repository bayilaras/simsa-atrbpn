
import http from 'node:http';

function requiredEnv(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`Required environment variable ${name} is not set. Refusing to use a default credential.`);
    }
    return value;
}

const email = requiredEnv('SIMSA_TEST_EMAIL');
const password = requiredEnv('SIMSA_TEST_PASSWORD');
const postData = JSON.stringify({
    email,
    password
});

const options = {
    hostname: '127.0.0.1',
    port: 3001,
    path: '/api/auth/sign-in/email',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
        try {
            const parsedData = JSON.parse(rawData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('✅ Login successful!');
                console.log('User:', parsedData.user);
            } else {
                console.error('❌ Login failed. Status:', res.statusCode);
                console.error('Raw response data:', rawData);
                console.error('Parsed response:', JSON.stringify(parsedData, null, 2));
            }
        } catch (e) {
            console.error('❌ Failed to parse response:', e.message);
            console.error('Raw response:', rawData);
            console.log('Response is not JSON.');
        }
    });
});

req.on('error', (e) => {
    console.error(`❌ Problem with request: ${e.message}`);
});

// Write data to request body
req.write(postData);
req.end();
