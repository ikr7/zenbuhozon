const fs = require('fs');
const fsp = fs.promises;

const fastify = require('fastify');
const puppeteer = require('puppeteer');
const mhtml2html = require('mhtml2html');
const { JSDOM } = require('jsdom');
const { google } = require('googleapis');


const credentialsPath = process.env.ZENBUHOZON_CREDENTIALS_PATH;
const tokenPath = process.env.ZENBUHOZON_TOKEN_PATH;
const folderId = process.env.ZENBUHOZON_FOLDER_ID;

async function authorize(credentials) {

    const oauth2Client = new google.auth.OAuth2(
        credentials.installed.client_id,
        credentials.installed.client_secret,
        credentials.installed.redirect_uris[0]
    );

    try {
        await fsp.access(tokenPath, fs.constants.R_OK);
    } catch (err) {
        return getAccessToken(oauth2Client);
    }

    oauth2Client.setCredentials(JSON.parse(await fsp.readFile(tokenPath)));

    return oauth2Client;

}

function input(question) {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function getAccessToken(oauth2Client) {

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.file']
    });

    console.log('Click link to authorize', authUrl);

    const code = await input('Code: ');

    let token;

    try {
        token = (await oauth2Client.getToken(code)).tokens;
    } catch (err) {
        console.error('Error retrieving access token', err);
        return;
    }

    oauth2Client.setCredentials(token);

    try {
        await fsp.writeFile(tokenPath, JSON.stringify(token));
    } catch (err) {
        console.error('Error saving token', err);
        return;
    }

    return oauth2Client;

}

async function uploadFile(data, title, url, oauth2Client) {

    const drive = google.drive({
        version: 'v3',
        auth: oauth2Client
    });

    const fileMetadata = {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        description: url,
        parents: [folderId]
    };

    const media = {
        mimeType: 'text/html',
        body: data
    };

    let file;

    try {
        file = await drive.files.create({
            resource: fileMetadata,
            media: media
        });
    } catch (err) {
        console.error('The API returned an error:', err);
        return;
    }

}

const app = fastify({
    logger: true
});

app.get('/', (request, reply) => {
    reply.send('It works!');
});

app.post('/history', async (request, reply) => {

    const entry = JSON.parse(request.body);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(entry.url);

    const title = await page.title();

    if (title.trim() !== '') {

        const name = `${title}_${(new Date()).toISOString()}`;

        const cdp = await page.target().createCDPSession();
        const { data } = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });

        const html = mhtml2html.convert(data, {
            parseDOM: html => new JSDOM(html)
        }).serialize();

        const credentials = JSON.parse(await fsp.readFile(credentialsPath));
        const oauth2Client = await authorize(credentials);

        uploadFile(html, name, entry.url, oauth2Client);

    }

    await browser.close();

    reply.header('Access-Control-Allow-Origin', '*');
    reply.send({ status: 'ok' });

});

app.listen(process.env.ZENBUHOZON_PORT);