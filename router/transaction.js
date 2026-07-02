import express from 'express';
import multer from 'multer';
import path from 'path';
import {
  getBusinessUnits,
  getDivisionsByBU,
  getEmployeesByDivision,
  getEmployeeData,
  getApprovalChain,
  createTemuan,
  updateTemuan,
  getTemuanForEdit,
  getTemuanList,
  getTemuanDetail,
  uploadFile
} from '../controllers/Transaction/inputRequestController.js';
import {
  getFilteredRequests,
  getRequestDetail,
  getRequestProgress,
  confirmClosingRequest,
  reopenRequest,
  getFeedbackData,
  getAllFeedbackByRequest,
  submitFeedback,
  confirmClosingItem
} from '../controllers/Transaction/confirmClosingController.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/temp/'); // Temporary storage
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, documents, and archives are allowed.'));
    }
  }
});

// Master Data Routes
router.get('/getBusinessUnits', getBusinessUnits);
router.get('/getDivisionsByBU', getDivisionsByBU);
router.get('/getEmployeesByDivision', getEmployeesByDivision);
router.post('/getEmployeeData', getEmployeeData);
router.get('/getApprovalChain', getApprovalChain);

// Temuan Routes
router.post('/createTemuan', upload.any(), createTemuan);
router.post('/updateTemuan', upload.any(), updateTemuan);
router.get('/getTemuanForEdit/:temuan_id', getTemuanForEdit);
router.get('/getTemuanList', getTemuanList);
router.get('/getTemuanDetail/:temuan_id', getTemuanDetail);

// File Upload Route
router.post('/uploadFile', upload.single('file'), uploadFile);

// Confirm Closing Routes
router.get('/getFilteredRequests', getFilteredRequests);
router.get('/getRequestDetail/:temuan_id', getRequestDetail);
router.get('/getRequestProgress/:temuan_id', getRequestProgress);
router.post('/confirmClosingRequest/:temuan_id', confirmClosingRequest);
router.post('/reopenRequest/:temuan_id', reopenRequest);

// Feedback Routes
router.get('/getFeedbackData/:listdet_id', getFeedbackData);
router.get('/getAllFeedbackByRequest/:temuan_id', getAllFeedbackByRequest);
router.post('/submitFeedback', upload.any(), submitFeedback);
router.post('/confirmClosingItem', upload.any(), confirmClosingItem);

export default router;
