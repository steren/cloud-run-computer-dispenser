import * as http from 'http';

const browserServiceID = process.env.BROWSER_SERVICE_ID || 'browser';

async function getGCPAccessToken() {
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const options = {
    headers: {
      'Metadata-Flavor': 'Google'
    }
  };
  try {
    const response = await fetch(metadataUrl, options);
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error fetching access token:', error);
    return null;
  }
}

async function getGCPProjectID() {
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/project/project-id';
  const options = {
    headers: {
      'Metadata-Flavor': 'Google'
    }
  };
  try {
    const response = await fetch(metadataUrl, options);
    return await response.text();
  } catch (error) {
    console.error('Error fetching project ID:', error);
    return null;
  }
}

async function getGCPProjectNumberAndRegion() {
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/region';
  const options = {
    headers: {
      'Metadata-Flavor': 'Google'
    }
  };
  try {
    const response = await fetch(metadataUrl, options);
    const fullString = await response.text();
    // format is projects/PROJECT-NUMBER/regions/REGION
    const parts = fullString.split('/');
    const region = parts[parts.length - 1];
    const projectNumber = parts[parts.length - 3];

    return {region, projectNumber};
  } catch (error) {
    console.error('Error fetching region:', error);
    return null;
  }
}

async function createNewBrowserRevision() {
  // generate a 6 letter identifier if not provided
  const generatedId = Math.random().toString(36).substring(2, 8);

  // TODO: consider allowing users to specify ID, but validate it heavily before using it.

  const revisionTag = `b${generatedId}`;
  const revisionName = `${browserServiceID}-${revisionTag}`;

  const projectId = await getGCPProjectID();
  const {region, projectNumber} = await getGCPProjectNumberAndRegion();
  const accessToken = await getGCPAccessToken();

  const revisionUrl = `https://${revisionTag}---${browserServiceID}-${projectNumber}.${region}.run.app`;



  const apiUrl = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${browserServiceID}`;
  
  // we cannot use update_mask=traffic,template.revision because Cloud Run doesn't support patch merge for the `traffic` attribute.

  try {

    // Get service
    const getOptions = {
        method: 'GET',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
        }
    };
    console.log(`Fetching service ${apiUrl}`);
    const getResponse = await fetch(apiUrl, getOptions);
    if (!getResponse.ok) {
        const errorBody = await getResponse.text();
        throw new Error(`HTTP error! status: ${getResponse.status}, message: ${getResponse.statusText}, body: ${errorBody}`);
      }

    const requestBody = await getResponse.json();

    // Updater service
    // See https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services#Service
    requestBody.traffic.push({
        tag: revisionTag,
        revision: revisionName,
        type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
    });
    requestBody.template.revision = revisionName;

    const options = {
        method: 'PATCH',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestBody)
    };

    console.log(`Creating new revision named ${revisionName} with traffic tag ${revisionTag} for service: ${apiUrl}`);

    const response = await fetch(apiUrl, options);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${response.statusText}, body: ${errorBody}`);
    }

    // TODO: wait for operation to complete, in the meantime, just wait a bit :)
    await new Promise(resolve => setTimeout(resolve, 15*1000));

    return {
      id: revisionTag,
      url: revisionUrl,
    };

  } catch (error) {
    console.error('Error creating new revision:', error);
    return null; // Indicate failure
  }
}

const port = process.env.PORT || 8080;
const server = http.createServer(async (req, res) => {
  if(req.method === 'POST') {
    const browserRevision = await createNewBrowserRevision();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(browserRevision));
  } else {
    return res.end(`<!DOCTYPE html>
        <html lang="en">
        <body>
            <p>Send a POST request on / to get a new browser, or click the button:</p>
            <form action="/" method="POST">
                <button type="submit">Get Browser</button>
            </form>
        </body>
        </html>`);
  }

});
server.listen(port, () => console.info(`browser-manager is listening on port ${port}`));

