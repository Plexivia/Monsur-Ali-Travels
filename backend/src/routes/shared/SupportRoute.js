import { Router } from "express";
import {
  requireSupportConfigured,
  rawAttachmentBody,
  listTickets,
  createTicket,
  getTicket,
  replyToTicket,
  uploadAttachment,
} from "../../controllers/shared/SupportController.js";
import { authenticateToken, authorizeRoles } from "../../middlewares/auth.middleware.js";
import {
  getSupportConfig,
  saveSupportConfig,
  publicSupportConfig,
  testSupportConnection,
} from "../../services/plexiviaSupport.service.js";
import { supportStreamStatus } from "../../services/plexiviaSupportStream.service.js";

const router = Router();

router.get("/config", authenticateToken, authorizeRoles("Owner", "Admin", "Superadmin"), async (req, res, next) => {
  try {
    const cfg = await getSupportConfig({ fresh: true });
    return res.json({ status: "success", data: { ...publicSupportConfig(cfg), live: supportStreamStatus() } });
  } catch (err) {
    return next(err);
  }
});

router.put("/config", authenticateToken, authorizeRoles("Owner", "Admin", "Superadmin"), async (req, res, next) => {
  try {
    const cfg = await saveSupportConfig(
      { apiBaseUrl: req.body?.apiBaseUrl, key: req.body?.key, remove: req.body?.remove === true },
      req.user?.userId
    );
    const test = cfg.configured ? await testSupportConnection(cfg) : null;
    return res.json({
      status: "success",
      message: cfg.configured ? (test.ok ? "Support Desk connected." : "Saved, but the connection test failed.") : "Support Desk disconnected.",
      data: { ...publicSupportConfig(cfg), test },
    });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ status: "error", message: err.message });
    return next(err);
  }
});

router.post("/config/test", authenticateToken, authorizeRoles("Owner", "Admin", "Superadmin"), async (req, res, next) => {
  try {
    const cfg = await getSupportConfig({ fresh: true });
    return res.json({ status: "success", data: { ...(await testSupportConnection(cfg)), live: supportStreamStatus() } });
  } catch (err) {
    return next(err);
  }
});

router.use(
  authenticateToken,
  authorizeRoles("Owner", "Admin", "Superadmin", "Manager"),
  requireSupportConfigured
);

router.get("/tickets", listTickets);
router.post("/tickets", createTicket);
router.get("/tickets/:id", getTicket);
router.post("/tickets/:id/messages", replyToTicket);
router.post("/attachments", rawAttachmentBody, uploadAttachment);

export default router;
