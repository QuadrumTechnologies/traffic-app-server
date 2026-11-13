/* eslint-disable node/no-extraneous-require */
const nodemailer = require("nodemailer");
const {
  generateEmailVerificationHTML,
  generateResetPasswordHTML,
  generateResetPasswordSuccessHTML,
  generateDeviceDeletedHTML,
  generateDeviceRestoredHTML,
  generateDeviceRecalledHTML,
  generateDeviceUnrecalledHTML,
  generateDeviceAssignmentHTML,
  generateInviteHTML,
  generateAccessRequestNoticeHTML,
  generateAccessRequestReceivedHTML,
  generateAccessRequestDeclinedHTML,
} = require("./emailTemplates");

class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = user.name.split(" ")[0];
    this.url = url;
    this.from = `Traffic Signal <${process.env.EMAIL_USERNAME}>`;
  }

  newTransport() {
    if (process.env.NODE_ENV === "production") {
      return nodemailer.createTransport({
        host: "smtp.zoho.com",
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
  async sendInvite(roleLabel) {
    await this.send(
      generateInviteHTML(this.firstName, this.url, roleLabel),
      "Your Traffic Control and Monitoring System account"
    );
  }

  // To Quadrum: someone asked for access, a demo, a quote or a partnership.
  async sendAccessRequestNotice(request) {
    const who = request.company || request.name || request.email || request.phone;
    await this.send(
      generateAccessRequestNoticeHTML(request, process.env.CLIENT_URL),
      `Access request: ${request.purposeLabel} · ${who}`
    );
  }

  // To the person who asked.
  async sendAccessRequestReceived(request) {
    await this.send(
      generateAccessRequestReceivedHTML(this.firstName, request),
      "We have your request · Quadrum Technologies"
    );
  }

  async sendAccessRequestDeclined(note) {
    await this.send(
      generateAccessRequestDeclinedHTML(this.firstName, note),
      "Your request · Quadrum Technologies"
    );
  }

  async sendPasswordResetSuccess() {
    await this.send(
      generateResetPasswordSuccessHTML(),
      "Account Password Reset Successful"
    );
  }

  async sendDeviceDeletedNotification() {
    await this.send(
      generateDeviceDeletedHTML(this.firstName),
      "Device Moved to Trash"
    );
  }

  async sendDeviceRestoredNotification() {
    await this.send(
      generateDeviceRestoredHTML(this.firstName),
      "Device Restored"
    );
  }
  async sendDeviceRecallNotification({ deviceId, autodeleteAt }) {
    await this.send(
      generateDeviceRecalledHTML(this.firstName, deviceId, autodeleteAt),
      "Device Recalled"
    );
  }
  async sendDeviceUnRecallNotification({ deviceId }) {
    await this.send(
      generateDeviceUnrecalledHTML(this.firstName, deviceId),
      "Device Unrecalled"
    );
  }
  async sendDeviceAssignmentNotification({ deviceId }) {
    await this.send(
      generateDeviceAssignmentHTML(this.firstName, deviceId),
      "Device Assignment"
    );
  }
}

module.exports = Email;
