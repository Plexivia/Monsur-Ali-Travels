import mongoose from "mongoose";
import { SalarySlip } from "../../models/salarySlip.model.js";
import { checkManagerCanDelete, checkManagerCanUpdate } from "../../helper/managerRbacHelper.js";
import { EmployeeModel } from "../../models/employee.model.js";
import { UserModel } from "../../models/user.model.js";

const findSalarySlipByIdOrCustomId = async (id, extraQuery = {}) => {
  if (!id) return null;
  const isMongoId = mongoose.isValidObjectId(id);
  const conditions = [{ did: id }, { slipNo: id }];
  if (isMongoId) conditions.push({ _id: id });
  return SalarySlip.findOne({ $or: conditions, ...extraQuery });
};


// Resolves the Employee (and its login User) a salary slip belongs to and
// writes the relational DIDs onto the payload. Matching order:
// employeeDid -> employeeCode / employeeId -> phone -> exact full name.
const resolveEmployeeLink = async (payload = {}) => {
  const conditions = [];
  const did = String(payload.employeeDid || "").trim();
  const code = String(payload.employeeCode || payload.employeeId || "").trim();
  const phone = String(payload.employeePhone || payload.phone || "").trim();
  const name = String(payload.employeeName || "").trim();

  if (did) conditions.push({ did });
  if (code) conditions.push({ employeeCode: code }, { did: code });
  if (phone) conditions.push({ phone });
  if (name) conditions.push({ fullName: name });

  if (conditions.length === 0) return payload;

  const employee = await EmployeeModel.findOne({ $or: conditions });
  if (!employee) return payload;

  payload.employeeDid = employee.did;
  payload.employeeCode = employee.employeeCode || payload.employeeCode || "";
  if (!payload.employeeId) payload.employeeId = employee.employeeCode || employee.did;
  if (!payload.designation || payload.designation === "Employee") {
    payload.designation = employee.designation || payload.designation;
  }
  if (!payload.department || payload.department === "Operations") {
    payload.department = employee.department || payload.department;
  }

  let userDid = employee.userDid || null;
  if (!userDid) {
    const userConditions = [];
    if (employee.email) userConditions.push({ email: employee.email });
    if (employee.phone) userConditions.push({ phone: employee.phone });
    if (userConditions.length > 0) {
      const user = await UserModel.findOne({ $or: userConditions });
      if (user) {
        userDid = user.did;
        // keep both sides of the link in step
        if (!employee.userDid) {
          employee.userDid = user.did;
          await employee.save();
        }
        if (!user.employeeDid) {
          user.employeeDid = employee.did;
          await user.save();
        }
      }
    }
  }
  payload.userDid = userDid;

  return payload;
};

// Mirrors a salary slip into Employee.salaryHistory (one entry per month, upserted).
const syncEmployeeSalaryHistory = async (slip, actorDid = null) => {
  if (!slip?.employeeDid || !slip.salaryMonth) return;
  try {
    const amount = Number(slip.netSalaryPayable) || 0;
    const employee = await EmployeeModel.findOne({ did: slip.employeeDid });
    if (!employee) return;

    employee.salaryHistory = employee.salaryHistory || [];
    const existing = employee.salaryHistory.find((h) => h.month === slip.salaryMonth);
    if (existing) {
      existing.amount = amount;
      existing.paidAt = new Date();
      existing.paidByDid = actorDid || existing.paidByDid;
      existing.remarks = `Slip ${slip.slipNo}`;
    } else {
      employee.salaryHistory.push({
        month: slip.salaryMonth,
        amount,
        paidAt: new Date(),
        paidByDid: actorDid,
        remarks: `Slip ${slip.slipNo}`,
      });
    }
    await employee.save();
  } catch (error) {
    console.error("syncEmployeeSalaryHistory error:", error);
  }
};

// Removes the slip's month entry from Employee.salaryHistory (on slip deletion).
const removeEmployeeSalaryHistory = async (slip) => {
  if (!slip?.employeeDid || !slip.salaryMonth) return;
  try {
    await EmployeeModel.updateOne(
      { did: slip.employeeDid },
      { $pull: { salaryHistory: { month: slip.salaryMonth } } }
    );
  } catch (error) {
    console.error("removeEmployeeSalaryHistory error:", error);
  }
};

// @desc    Get all salary slips
// @route   GET /api/v1/docs/payrolls
export const getSalarySlips = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = req.query.limit !== undefined ? Math.max(1, parseInt(req.query.limit, 10) || 10) : 10;
    const skip = req.query.skip !== undefined ? Math.max(0, parseInt(req.query.skip, 10)) : (page - 1) * limit;
    const { search, month } = req.query;

    const query = {};
    query.isActive = { $ne: false };

    if (month && month !== "all") {
      query.salaryMonth = new RegExp(month.trim(), "i");
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      query.$or = [
        { slipNo: searchRegex },
        { employeeName: searchRegex },
        { employeeId: searchRegex },
        { employeeCode: searchRegex },
        { employeeDid: searchRegex },
        { designation: searchRegex },
        { department: searchRegex },
      ];
    }

    const totalCount = await SalarySlip.countDocuments(query);
    const slips = await SalarySlip.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalCount / limit) || 1;

    return res.status(200).json({
      success: true,
      status: "success",
      count: slips.length,
      data: slips,
      pagination: {
        skip,
        limit,
        totalCount,
        page,
        totalPages,
        hasNextPage: skip + slips.length < totalCount,
        hasPrevPage: skip > 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single salary slip by ID, did, or slipNo
// @route   GET /api/v1/docs/payrolls/:id
export const getSalarySlipById = async (req, res, next) => {
  try {
    const slip = await findSalarySlipByIdOrCustomId(req.params.id, { isActive: { $ne: false } });
    if (!slip) {
      return res.status(404).json({
        success: false,
        status: "error",
        message: "Salary slip not found",
      });
    }
    return res.status(200).json({
      success: true,
      status: "success",
      data: slip,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new salary slip
// @route   POST /api/v1/docs/payrolls
export const createSalarySlip = async (req, res, next) => {
  try {
    const payload = await resolveEmployeeLink({
      ...req.body,
      createdByDid: req.user?.did || null,
      createdByName: req.user?.name || "Staff",
    });
    const newSlip = await SalarySlip.create(payload);

    await syncEmployeeSalaryHistory(newSlip, req.user?.did || null);

    return res.status(201).json({
      success: true,
      status: "success",
      message: "Salary slip created successfully",
      data: newSlip,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update existing salary slip
// @route   PUT /api/v1/docs/payrolls/:id
export const updateSalarySlip = async (req, res, next) => {
  try {
    const existing = await findSalarySlipByIdOrCustomId(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        status: "error",
        message: "Salary slip not found",
      });
    }

    if (!checkManagerCanUpdate(req, res, existing, "Salary slip")) {
      return;
    }

    const updatePayload = await resolveEmployeeLink({
      ...req.body,
      employeeDid: req.body?.employeeDid || existing.employeeDid || undefined,
      employeeName: req.body?.employeeName || existing.employeeName,
      employeeId: req.body?.employeeId || existing.employeeId,
    });

    const updatedSlip = await SalarySlip.findOneAndUpdate(
      { _id: existing._id },
      updatePayload,
      { new: true, runValidators: true }
    );

    await syncEmployeeSalaryHistory(updatedSlip, req.user?.did || null);

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Salary slip updated successfully",
      data: updatedSlip,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete salary slip
// @route   DELETE /api/v1/docs/payrolls/:id
export const deleteSalarySlip = async (req, res, next) => {
  try {
    if (!checkManagerCanDelete(req, res, "Salary slip")) {
      return;
    }

    const existing = await findSalarySlipByIdOrCustomId(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        status: "error",
        message: "Salary slip not found",
      });
    }

    await SalarySlip.findOneAndUpdate({ _id: existing._id }, { isActive: false }, { new: true });
    await removeEmployeeSalaryHistory(existing);

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Salary slip deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
