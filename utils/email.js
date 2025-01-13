/* eslint-disable node/no-extraneous-require */
const nodemailer = require("nodemailer");
const {
  generateEmailVerificationHTML,
  generateResetPasswordHTML,
  generateResetPasswordSuccessHTML,
} = require("./emailTemplates");

class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = user.name.split(" ")[0];
    this.url = url;
    this.from = `Joel Ojerinde <${process.env.EMAIL_USERNAME}>`;
  }

  newTransport() {
    if (process.env.NODE_ENV === "production") {
      return nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
    }

    return nodemailer.createTransport({
      host: process.env.MAILTRAP_HOST,
      port: process.env.MAILTRAP_PORT,
      auth: {
        user: process.env.MAILTRAP_USER,
        pass: process.env.MAILTRAP_PASSWORD,
      },
    });
  }

  // Send the actual email
  async send(html, subject) {
    // 1) Define email options
    const mailOptions = {
      from: this.from,
      to: this.to,
      subject: subject,
      html: html,
    };

    // 2) Create a transport and send email
    await this.newTransport().sendMail(mailOptions);
  }

  async sendWelcome() {
    await this.send("Welcome to the Attendance System Website");
  }

  async sendEmailVerification() {
    await this.send(
      generateEmailVerificationHTML(this.firstName, this.url),
      "Email Verification Link"
    );
  }
  async sendPasswordReset() {
    await this.send(
      generateResetPasswordHTML(this.firstName, this.url),
      "Password Reset Link (valid for only 1 hour)"
    );
  }
  async sendPasswordResetSuccess() {
    await this.send(
      generateResetPasswordSuccessHTML(),
      "Account Password Reset Successful"
    );
  }
}

module.exports = Email;
