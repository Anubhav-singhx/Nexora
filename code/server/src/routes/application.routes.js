// OWNER: Person 1. Customer-facing application + document APIs.
import { Router } from 'express';
import { ROLES } from '../constants.js';
import * as ctrl from '../controllers/application.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { applicationAudit, applicationAuditExport } from '../controllers/audit.controller.js';
import { documentUpload } from '../services/uploads.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(authenticate);

router.post('/', requireRole(ROLES.APPLICANT), documentUpload, asyncHandler(ctrl.createApplication));
router.get('/', requireRole(ROLES.APPLICANT), asyncHandler(ctrl.listMyApplications));

// Object-level access (own application vs someone else's) is enforced inside the controllers.
router.get('/:id', asyncHandler(ctrl.getApplication));
router.post('/:id/resubmit', requireRole(ROLES.APPLICANT), documentUpload, asyncHandler(ctrl.resubmitApplication));
router.get('/:id/audit', requireRole(ROLES.KYC_OFFICER, ROLES.COMPLIANCE_OFFICER), asyncHandler(applicationAudit));
router.get('/:id/audit/export', requireRole(ROLES.COMPLIANCE_OFFICER), asyncHandler(applicationAuditExport));
router.get('/:id/decision', asyncHandler(ctrl.getDecision));
router.get('/:id/documents', asyncHandler(ctrl.listDocuments));
router.get('/:id/documents/:docId/content', asyncHandler(ctrl.getDocumentContent));

export default router;
