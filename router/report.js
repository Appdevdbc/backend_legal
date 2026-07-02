import express from "express";
import { getMonitoringSPK, exportMonitoringSPK, getDepartmentList } from "../controllers/Report/monitoringSPKController.js";
import { getMesinHours, getOperatorHours, getJobTypeList } from "../controllers/Report/operatorMesinController.js";
import { getSlaSectionChart, getSlaSectionDetail } from "../controllers/Report/slaSectionController.js";
import { getSlaPeriode, getPenyelesaianSPK, getSpkPeriodeYTD } from "../controllers/Report/slaGeneralPeriodeController.js";
import {
  getSlaGeneralYTD, getSlaGeneralYTDSummary,
  getSlaGeneralYTDDetail, getSlaGeneralYTDHari,
  getSlaGeneralYTDJam, getSlaGeneralYTDSection, getSlaGeneralYTDOpr,
} from "../controllers/Report/slaGeneralYTDController.js";
import { getSpkTotal, getSpkTotalBulan } from "../controllers/Report/spkTotalController.js";
import {
  getSpkGeneral, getSpkTotalDaily, getDeptListGeneral,
} from "../controllers/Report/spkGeneralController.js";
import { getSpkMold, getDeptListMold } from "../controllers/Report/spkMoldController.js";
import { getGanttChart, getGanttSpkList } from "../controllers/Report/ganttController.js";
import {
  getOvertimeJobType, getOvertimeMonthly, getOvertimeSection,
} from "../controllers/Report/overtimeController.js";
import { getTJKNReport, getTJKNDetail } from "../controllers/Report/tjknReportController.js";
import {
  getPerformanceEmployee, savePerformanceEmployee, getEmployeeList,
} from "../controllers/Report/performanceEmployeeController.js";
import {
  getTemuanReport, getJudulTemuan, getBusinessUnits as getBusinessUnitsReport, getDivisionsByBU as getDivisionsByBUReport
} from "../controllers/Report/temuanController.js";

const router = express.Router();

// Monitoring SPK routes
router.get('/getMonitoringSPK', getMonitoringSPK);
router.post('/exportMonitoringSPK', exportMonitoringSPK);
router.get('/getDepartmentList', getDepartmentList);

// Operator & Mesin Hours routes
router.get('/getJobTypeList', getJobTypeList);
router.get('/getMesinHours', getMesinHours);
router.get('/getOperatorHours', getOperatorHours);

// SLA Section routes
router.get('/getSlaSectionChart', getSlaSectionChart);
router.get('/getSlaSectionDetail', getSlaSectionDetail);

// SLA General Periode routes
router.get('/getSlaPeriode', getSlaPeriode);
router.get('/getPenyelesaianSPK', getPenyelesaianSPK);
router.get('/getSpkPeriodeYTD', getSpkPeriodeYTD);

// SLA General YTD routes
router.get('/getSlaGeneralYTD', getSlaGeneralYTD);
router.get('/getSlaGeneralYTDSummary', getSlaGeneralYTDSummary);
router.get('/getSlaGeneralYTDDetail', getSlaGeneralYTDDetail);
router.get('/getSlaGeneralYTDHari', getSlaGeneralYTDHari);
router.get('/getSlaGeneralYTDJam', getSlaGeneralYTDJam);
router.get('/getSlaGeneralYTDSection', getSlaGeneralYTDSection);
router.get('/getSlaGeneralYTDOpr', getSlaGeneralYTDOpr);

// SPK Total routes
router.get('/getSpkTotal', getSpkTotal);
router.get('/getSpkTotalBulan', getSpkTotalBulan);

// SPK General routes
router.get('/getSpkGeneral', getSpkGeneral);
router.get('/getSpkTotalDaily', getSpkTotalDaily);
router.get('/getDeptListGeneral', getDeptListGeneral);

// SPK Mold routes
router.get('/getSpkMold', getSpkMold);
router.get('/getDeptListMold', getDeptListMold);

// Gantt Chart routes
router.get('/getGanttSpkList', getGanttSpkList);
router.get('/getGanttChart', getGanttChart);

// Overtime routes
router.get('/getOvertimeJobType', getOvertimeJobType);
router.get('/getOvertimeMonthly', getOvertimeMonthly);
router.get('/getOvertimeSection', getOvertimeSection);

// TJKN Report routes
router.get('/getTJKNReport', getTJKNReport);
router.get('/getTJKNDetail', getTJKNDetail);

// Performance Employee routes
router.get('/getPerformanceEmployee', getPerformanceEmployee);
router.post('/savePerformanceEmployee', savePerformanceEmployee);
router.get('/getEmployeeListPerf', getEmployeeList);

// Temuan Report routes
router.get('/getTemuanReport', getTemuanReport);
router.get('/getJudulTemuan', getJudulTemuan);
router.get('/getBusinessUnitsReport', getBusinessUnitsReport);
router.get('/getDivisionsByBUReport', getDivisionsByBUReport);

export default router;
