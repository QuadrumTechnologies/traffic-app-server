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
                   <img src="https://schooltry-tertiary-2.s3.eu-west-1.amazonaws.com/institutionLogos/Unilorin_6500995e76d79.jpeg" alt="Unilorin">
                </div>
                <div class="content">
                    <h1>Hello, ${firstName}!</h1>
                    <p>Click the button below to verify your email:</p>
                    <a href="${emailVerificationURL}" class="button">Verify Email</a>
                    <p>Please note that the link will remain active for only one hour.</p>
                    <p>If the button above doesn't work, copy and paste the following URL into your browser:</p>
                    <p>${emailVerificationURL}</p>
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
                     <img src="https://schooltry-tertiary-2.s3.eu-west-1.amazonaws.com/institutionLogos/Unilorin_6500995e76d79.jpeg" alt="Unilorin">
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
                    <p>Thank you,</p>
                    <p>Attendance System</p>
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
                <img src="https://schooltry-tertiary-2.s3.eu-west-1.amazonaws.com/institutionLogos/Unilorin_6500995e76d79.jpeg" alt="Unilorin">
                </div>
                <div class="content">
                    <h1>Password Reset Successful</h1>
                    <p>Your password has been successfully reset. You can now use your new password to log in.</p>
                    <p>Should you have any additional questions or concerns, please don't hesitate to reach out to our dedicated support team.</p>
                    <p>Thank you for choosing Attendance System!</p>
                </div>
            </div>
        </body>
        </html>
      `;
};

const generateBaseHTML = function (content) {
  return `
      <!DOCTYPE html>
      <html>
      <head>
          <title>${content.title}</title>
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
                  height: 90px;
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
                  <img src="https://schooltry-tertiary-2.s3.eu-west-1.amazonaws.com/institutionLogos/Unilorin_6500995e76d79.jpeg" alt="Unilorin">
              </div>
              <div class="content">
                  <h1>${content.heading}</h1>
                  <p>Hello ${content.firstName},</p>
                  <p>${content.body}</p>
                  ${content.table ? content.table : ""}
                  ${
                    content.button
                      ? `<a href="${content.buttonLink}" class="button">${content.buttonText}</a>`
                      : ""
                  }
                  ${content.footer ? `<p>${content.footer}</p>` : ""}
                  <p>Thank you,</p>
                  <p>Attendance System</p>
              </div>
          </div>
      </body>
      </html>
    `;
};

exports.generateAttendanceAlertHTML = function (
  studentName,
  courseCode,
  missedPercentage
) {
  return generateBaseHTML({
    title: "Attendance Alert",
    heading: "Attendance Alert",
    firstName: studentName,
    body: `You have missed ${missedPercentage}% of the classes for the course ${courseCode}. Please ensure to attend the upcoming classes.`,
  });
};

exports.generateAttendanceReportHTML = function (
  recipientName,
  courseCode,
  studentDetails
) {
  const tableRows = studentDetails
    .map(
      (student) =>
        `<tr><td>${student.name}</td><td>${student.matricNo}</td><td>${student.missedPercentage}</td></tr>`
    )
    .join("");

  const tableHTML = `
      <table border="1" cellpadding="10" cellspacing="0">
        <thead>
          <tr>
            <th>Name</th>
            <th>Matric No</th>
            <th>Attendance Missed Percentage</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    `;

  return generateBaseHTML({
    title: "Attendance Report",
    heading: "Attendance Report",
    firstName: recipientName,
    body: `The following students were not present today and have also missed more than 50% of the classes for the course ${courseCode}:`,
    table: tableHTML,
  });
};
