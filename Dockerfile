FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application
COPY . .

# Expose all honeypot trap ports and the dashboard
# 3000: Dashboard
# 8080: HTTP Honeypot
# 2222: SSH Honeypot
# 2121: FTP Honeypot
# 2323: Telnet Honeypot
EXPOSE 3000 8080 2222 2121 2323

# Start the honeypot orchestration server
CMD [ "node", "server.js" ]
