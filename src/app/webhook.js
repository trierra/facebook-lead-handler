'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
var sesTransport = require('nodemailer-ses-transport');

const log = require('winston');
log.level = 'debug';
log.add(log.transports.File, {filename: 'logfile.log'});

const nodemailer = require('nodemailer');
const configFile = '../config/config.json';

var configuration = JSON.parse(
    fs.readFileSync(configFile)
);

const formId = configuration.formId.id;

var access_token = 'EAAXxIatCqX4BAHC6aZAUscR9u50xQ9HDuGeVx4ZBDIGF8npglqjKfKjkqZACl8rrt4uU7MkaghZApSdqiKDuxnn1meeFiPcBxxzKC8QRdXOotpOlWyzntUIWrTKwxTQvFHbceZBbyjcPY5KZBCuQz4fYr0weqL622G867VvVp5uAZDZD'

app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());


// for Facebook verification
/**@prod*/
app.get('/webhook/', function (req, res) {
    if (req.query['hub.verify_token'] === configuration.webhookVerification) {
        res.send(req.query['hub.challenge'])
    } else {
        res.send('Error, wrong token')
    }
});


/**@prod, catches ping leads*/
app.post('/webhook/', function (req, res) {

    var leadId = req.body.entry[0].changes[0].value.leadgen_id;
    log.log('Loaded lead ' + leadId );

    if (leadId) {
        loadLeadDetails(leadId, function (data) {
            if (data) {
                var email = '';
                for (var i in data.field_data) {
                    if (data.field_data[i].name === 'email') {
                        email = data.field_data[i].values[0];
                        break;
                    }
                }
                log.log('Lead details: id ' + leadId + ', email: ' + email + ' at ' + new Date());

                sendMail(email);
            }
        });
    }
});

/**
 * test
 */
app.get('/parse', function (req, resp) {

    loadLeadDetails('leadid', function (data) {
        if (data) {
            var email = '';
            for (var element in data.field_data) {
                if (data.field_data[element].name === 'email') {
                    email = data.field_data[element].values[0];
                }
            }
            log.log('Email from lead: ', email);
            sendMail(email);
        }
    });

});

/**
 * prod
 * @param leadId
 * @param callback
 */
function loadLeadDetails(leadId, callback) {
    log.warn('Loading details...');
    var url = buildUrl(leadId);

    console.log(url);

    var options = {
        url: url,
        encoding: 'utf-8'
    };

    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            log.warn(body);
            var data = JSON.parse(body);
            if (data.error) {
                if (data.error.message.includes('Error validating access token')) {
                    log.warn('Session has expired, refreshing token on ' + new Date());
                    access_token = refreshToken();
                    loadLeadDetails(leadId, callback);
                } else {
                    log.warn(data.error.message);
                    console.log(data.error.message);
                }
            } else {
                callback(data)
            }
        }
    });
}

//TODO: finish
function refreshToken() {
    return 'EAAXxIatCqX4BAIzO00F2TSHzjSbS8MX3y9z4ARqa5Xow4ly0SaBZBKWBteCo3pbPXHya9qbLxcedD3RZC8Ajk2ezfZAPa5PfphVEblQLah0U9KbrLEuWpUy3TRZC10fgQSmnEF12BMX0mcQI6p7acjZBR6qzPqo1fxQZBCLkSzxAZDZD';
}

//TODO: refactor
function buildUrl(leadId) {
    return 'https://graph.facebook.com/v2.8/' + leadId + '?access_token=' + access_token +
        '&format=json&method=get&pretty=0&suppress_http_code=1';
}

function sendMail(email) {
    log.log('sending mail to ' + email);
    log.warn('sending mail to ' + email);

    var transporter = nodemailer.createTransport(sesTransport({
        accessKeyId: configuration.smtp.accessKey,
        secretAccessKey: configuration.smtp.secret,
        rateLimit: 5, // do not send more than 5 messages in a second
        region: configuration.smtp.region,
        host: configuration.smtp.host
    }));

    var mailOptions = {
        from: configuration.smtp.sender,
        to: configuration.smtp.sender, //temporary for test mode
        subject: 'New lead',
        text: 'With email ' + email
    };

// send mail with defined transport object
    transporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            return log.error(error);
        }
        log.log('Message sent: to ' + email + ' ' + info.response);
    });
}

/**@prod*/
app.get('/platform', function (req, res) {
    res.sendFile(path.join(__dirname + '../view/platform.html'));
});


// var options = {
//     key: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/privkey.pem'),
//     cert: fs.readFileSync('/etc/letsencrypt/live/willingbot.online/fullchain.pem')
// };
//
// https.createServer(options, app).listen(8443);
http.createServer(app).listen(8000);
