exports.generateEmailVerificationHTML = function (
  firstName,
  emailVerificationURL
) {
  return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Email Verification</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 0;
                    color: #333;
                }
                img {
                    width: 80px;
                    height: 90px
                }
                .container {
                    background-color: #fff;
                    margin: 50px auto;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    max-width: 600px;
                }
                .header {
                    text-align: center;
                    border-bottom: 1px solid #ddd;
                    padding-bottom: 20px;
                }
                .header img {
                    max-width: 150px;
                }
                .content {
                    padding: 20px;
                }
                .button {
                    display: inline-block;
                    padding: 10px 20px;
                    margin: 20px 0;
                    background-color: #181a40;
                    color: #fff;
                    text-decoration: none;
                    border-radius: 5px;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                   <img src="https://pixabay.com/vectors/traffic-light-red-black-green-24177/" alt="Traffic">
                </div>
                <div class="content">
                    <h1>Hello, ${firstName}!</h1>
                    <p>Click the button below to verify your email:</p>
                    <a href="${emailVerificationURL}" class="button">Verify Email</a>
                    <p>Please note that the link will remain active for only one hour.</p>
                    <p>If the button above doesn't work, copy and paste the following URL into your browser:</p>
                    <p>${emailVerificationURL}</p>
                    <p><strong>Best Regards,</strong><br>Support Team</p>
                </div>
            </div>
        </body>
        </html>
      `;
};

exports.generateResetPasswordHTML = function (firstName, resetPasswordUrl) {
  return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Reset Password</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 0;
                    color: #333;
                }
                img {
                    width: 80px;
                    height: 90px
                }
                .container {
                    background-color: #fff;
                    margin: 50px auto;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    max-width: 600px;
                }
                .header {
                    text-align: center;
                    border-bottom: 1px solid #ddd;
                    padding-bottom: 20px;
                }
                .header img {
                    max-width: 150px;
                }
                .content {
                    padding: 20px;
                }
                .button {
                    display: inline-block;
                    padding: 15px 25px;
                    margin: 20px 0;
                    background-color: #181a40;
                    color: #fff;
                    text-decoration: none;
                    border-radius: 5px;
                    text-align: center;
                }
                  .button:hover {
                  background-color: #181a40;
                  }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                     <img src="https://pixabay.com/vectors/traffic-light-red-black-green-24177/" alt="Traffic">
                </div>
                <div class="content">
                    <h1>Password Reset</h1>
                    <p>Hello ${firstName},</p>
                    <p>We received a request to reset your password. If you did not make this request, please ignore this email.</p>
                    <p>To reset your password, please click the following button:</p>
                    <a href="${resetPasswordUrl}" class="button">Reset Password</a>
                    <p>If the above link doesn't work, copy and paste the following URL into your browser:</p>
                    <p>${resetPasswordUrl}</p>
                    <p>This link will expire in 1 hour.</p>
                    <p><strong>Best Regards,</strong><br>Support Team</p>
                </div>
            </div>
        </body>
        </html>
      `;
};

exports.generateResetPasswordSuccessHTML = function () {
  return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Password Reset Successful</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 0;
                    color: #333;
                }
                 img {
                    width: 80px;
                    height: 90px
                }
                .container {
                    background-color: #fff;
                    margin: 50px auto;
                    padding: 20px;
                    border-radius: 10px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                    max-width: 600px;
                }
                .header {
                    text-align: center;
                    border-bottom: 1px solid #ddd;
                    padding-bottom: 20px;
                }
                .header img {
                    max-width: 150px;
                }
                .content {
                    padding: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                <img src="https://pixabay.com/vectors/traffic-light-red-black-green-24177/" alt="Traffic">
                </div>
                <div class="content">
                    <h1>Password Reset Successful</h1>
                    <p>Your password has been successfully reset. You can now use your new password to log in.</p>
                    <p>Should you have any additional questions or concerns, please don't hesitate to reach out to our dedicated support team.</p>
                    <p><strong>Best Regards,</strong><br>Support Team</p>
                </div>
            </div>
        </body>
        </html>
      `;
};

exports.generateDeviceDeletedHTML = function (firstName) {
  return `
          <!DOCTYPE html>
          <html>
          <head>
              <title>Device Moved to Trash</title>
              <style>
                  body {
                      font-family: Arial, sans-serif;
                      background-color: #f4f4f4;
                      margin: 0;
                      padding: 0;
                      color: #333;
                  }
                  .container {
                      background-color: #fff;
                      margin: 50px auto;
                      padding: 20px;
                      border-radius: 10px;
                      box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                      max-width: 600px;
                  }
                  .header {
                      text-align: center;
                      border-bottom: 1px solid #ddd;
                      padding-bottom: 20px;
                  }
                  .content {
                      padding: 20px;
                  }
                  .button {
                      display: inline-block;
                      padding: 10px 20px;
                      margin: 20px 0;
                      background-color: #d9534f;
                      color: #fff;
                      text-decoration: none;
                      border-radius: 5px;
                      text-align: center;
                  }
              </style>
          </head>
          <body>
              <div class="container">
                  <div class="header">
                      <h2>Device Moved to Trash</h2>
                  </div>
                  <div class="content">
                      <h3>Hello, ${firstName}!</h3>
                      <p>Your device has been moved to trash. It will be permanently deleted after 30 days.</p>
                      <p>If this was a mistake, please contact the administrator to restore it.</p>
                       <p><strong>Best Regards,</strong><br>Support Team</p>
                  </div>
              </div>
          </body>
          </html>
        `;
};

exports.generateDeviceRestoredHTML = function (firstName) {
  return `
          <!DOCTYPE html>
          <html>
          <head>
              <title>Device Restored</title>
              <style>
                  body {
                      font-family: Arial, sans-serif;
                      background-color: #f4f4f4;
                      margin: 0;
                      padding: 0;
                      color: #333;
                  }
                  .container {
                      background-color: #fff;
                      margin: 50px auto;
                      padding: 20px;
                      border-radius: 10px;
                      box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                      max-width: 600px;
                  }
                  .header {
                      text-align: center;
                      border-bottom: 1px solid #ddd;
                      padding-bottom: 20px;
                  }
                  .content {
                      padding: 20px;
                  }
                  .button {
                      display: inline-block;
                      padding: 10px 20px;
                      margin: 20px 0;
                      background-color: #28a745;
                      color: #fff;
                      text-decoration: none;
                      border-radius: 5px;
                      text-align: center;
                  }
              </style>
          </head>
          <body>
              <div class="container">
                  <div class="header">
                      <h2>Device Restored</h2>
                  </div>
                  <div class="content">
                      <h3>Hello, ${firstName}!</h3>
                      <p>Your device has been successfully restored by the administrator.</p>
                      <p>You can now continue using it without any issues.</p>
                  </div>
              </div>
          </body>
          </html>
        `;
};

exports.generateDeviceRecalledHTML = function (
  firstName,
  deviceId,
  autodeleteAt
) {
  return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Device Recalled</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f4f4f4;
                        margin: 0;
                        padding: 0;
                        color: #333;
                    }
                    .container {
                        background-color: #fff;
                        margin: 50px auto;
                        padding: 20px;
                        border-radius: 10px;
                        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                        max-width: 600px;
                    }
                    .header {
                        text-align: center;
                        border-bottom: 1px solid #ddd;
                        padding-bottom: 20px;
                    }
                    .content {
                        padding: 20px;
                    }
                    .button {
                        display: inline-block;
                        padding: 10px 20px;
                        margin: 20px 0;
                        background-color: #dc3545;
                        color: #fff;
                        text-decoration: none;
                        border-radius: 5px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Device Recalled</h2>
                    </div>
                    <div class="content">
                        <h3>Hello, ${firstName}!</h3>
                         <p>Your device <strong>${deviceId}</strong> has been recalled by the administrator.</p>
      <p>Please remove the device from your dashboard immediately.</p>
      <p>If you do not remove the device, it will be <strong>automatically deleted</strong> on <strong>${autodeleteAt}</strong>.</p>
      <p>Best Regards,<br>Support Team</p>
                    </div>
                </div>
            </body>
            </html>
          `;
};

exports.generateDeviceUnrecalledHTML = function (firstName, deviceId) {
  return `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Device Unrecalled</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            background-color: #f4f4f4;
                            margin: 0;
                            padding: 0;
                            color: #333;
                        }
                        .container {
                            background-color: #fff;
                            margin: 50px auto;
                            padding: 20px;
                            border-radius: 10px;
                            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                            max-width: 600px;
                        }
                        .header {
                            text-align: center;
                            border-bottom: 1px solid #ddd;
                            padding-bottom: 20px;
                        }
                        .content {
                            padding: 20px;
                        }
                        .button {
                            display: inline-block;
                            padding: 10px 20px;
                            margin: 20px 0;
                            background-color: #28a745;
                            color: #fff;
                            text-decoration: none;
                            border-radius: 5px;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h2>Device Unrecalled</h2>
                        </div>
                        <div class="content">
                            <h3>Hello ${firstName},</h3>
                            <p>We are pleased to inform you that your device <strong>${deviceId}</strong> has been successfully **unrecalled** by the administrator.</p>
                            <p>You can continue using your device as usual.</p>
                            <p>If you have any questions or need further assistance, feel free to contact our support team.</p>
                            <p><strong>Best Regards,</strong><br>Support Team</p>
                        </div>
                    </div>
                </body>
                </html>
              `;
};

exports.generateDeviceAssignmentHTML = function (firstName, deviceId) {
  return `
                  <!DOCTYPE html>
                  <html>
                  <head>
                      <title>Device Assigned</title>
                      <style>
                          body {
                              font-family: Arial, sans-serif;
                              background-color: #f4f4f4;
                              margin: 0;
                              padding: 0;
                              color: #333;
                          }
                          .container {
                              background-color: #fff;
                              margin: 50px auto;
                              padding: 20px;
                              border-radius: 10px;
                              box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                              max-width: 600px;
                          }
                          .header {
                              text-align: center;
                              border-bottom: 1px solid #ddd;
                              padding-bottom: 20px;
                          }
                          .content {
                              padding: 20px;
                          }
                          .button {
                              display: inline-block;
                              padding: 10px 20px;
                              margin: 20px 0;
                              background-color: #007bff;
                              color: #fff;
                              text-decoration: none;
                              border-radius: 5px;
                              font-weight: bold;
                          }
                      </style>
                  </head>
                  <body>
                      <div class="container">
                          <div class="header">
                              <h2>Device Assigned</h2>
                          </div>
                          <div class="content">
                              <h3>Hello ${firstName},</h3>
                              <p>We are pleased to inform you that a device has been assigned to you.</p>
                              <p><strong>Device ID:</strong> ${deviceId}</p>
                              <p>If you have any questions, feel free to contact our support team.</p>
                              <p><strong>Best Regards,</strong><br>Support Team</p>
                          </div>
                      </div>
                  </body>
                  </html>
                `;
};
