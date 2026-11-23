import { EmployeeModel } from "../models/employee.model.js";
import { UserModel } from "../models/user.model.js";

const ROLES_WITH_EMPLOYEE_RECORD = ["Staff", "Admin", "Manager", "Owner"];

/**
 * Ensures a staff User has a matching Employee record and that both sides
 * carry each other's DID (User.employeeDid <-> Employee.userDid).
 * Matches an existing Employee by userDid, email, or phone before creating one.
 * Returns the linked Employee document, or null when no record applies.
 */
export async function ensureEmployeeForUser(user, actorDid = null) {
  if (!user) return null;
  if (!ROLES_WITH_EMPLOYEE_RECORD.includes(user.role)) return null;

  try {
    const conditions = [{ userDid: user.did }];
    if (user.email) conditions.push({ email: String(user.email).toLowerCase().trim() });
    if (user.phone) conditions.push({ phone: String(user.phone).trim() });

    let employee = await EmployeeModel.findOne({ $or: conditions });

    if (!employee) {
      employee = await EmployeeModel.create({
        userDid: user.did,
        fullName: user.name,
        phone: user.phone || "N/A",
        email: user.email || undefined,
        designation: user.designation || user.subRole || user.role || "Staff",
        department: user.department || "General",
        accessLevel: user.role === "Staff" ? "Level_1" : "Full_Staff",
        status: user.isActive === false ? "On_Leave" : "Active",
        createdByDid: actorDid,
      });
    } else if (!employee.userDid) {
      employee.userDid = user.did;
      employee.updatedByDid = actorDid;
      await employee.save();
    }

    if (user.employeeDid !== employee.did) {
      await UserModel.updateOne({ _id: user._id }, { employeeDid: employee.did });
      user.employeeDid = employee.did;
    }

    return employee;
  } catch (error) {
    console.error("ensureEmployeeForUser error:", error);
    return null;
  }
}

/**
 * Keeps the linked Employee record in step with User profile edits.
 */
export async function syncEmployeeFromUser(user, actorDid = null) {
  if (!user?.employeeDid) return null;
  try {
    const employee = await EmployeeModel.findOne({ did: user.employeeDid });
    if (!employee) return null;

    if (user.name) employee.fullName = user.name;
    if (user.phone) employee.phone = user.phone;
    if (user.email) employee.email = String(user.email).toLowerCase().trim();
    if (user.designation) employee.designation = user.designation;
    if (user.department) employee.department = user.department;
    if (user.isActive === false && employee.status === "Active") employee.status = "On_Leave";
    if (user.isActive === true && employee.status === "On_Leave") employee.status = "Active";
    employee.updatedByDid = actorDid;

    await employee.save();
    return employee;
  } catch (error) {
    console.error("syncEmployeeFromUser error:", error);
    return null;
  }
}

/**
 * Links a newly created Employee to an existing login User (by email/phone).
 * Does not create a User account - credentials must be issued from the
 * Users panel so the password is set by an administrator.
 */
export async function linkUserToEmployee(employee, actorDid = null) {
  if (!employee) return null;
  try {
    const conditions = [];
    if (employee.userDid) conditions.push({ did: employee.userDid });
    if (employee.email) conditions.push({ email: String(employee.email).toLowerCase().trim() });
    if (employee.phone) conditions.push({ phone: String(employee.phone).trim() });
    if (conditions.length === 0) return null;

    const user = await UserModel.findOne({ $or: conditions });
    if (!user) return null;

    if (!employee.userDid) {
      employee.userDid = user.did;
      employee.updatedByDid = actorDid;
      await employee.save();
    }
    if (user.employeeDid !== employee.did) {
      await UserModel.updateOne({ _id: user._id }, { employeeDid: employee.did });
    }
    return user;
  } catch (error) {
    console.error("linkUserToEmployee error:", error);
    return null;
  }
}
