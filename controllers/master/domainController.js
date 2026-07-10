import { db, dbDMS} from "../../config/db.js";
import { checkRoleDependencies, convertAccessPermissions, createLogEntry, 
  encryptAccessPermissions, encryptMenuIds, encryptRoleIds, 
  hasAnyPermission, processLocationData, processSiteItem } from "../../helpers/master/domain.js";
import { decrypt,encrypt, getErrorResponse, getWSA, insertInChunks, objectToString } from "../../helpers/utils.js";
import { logger } from "../../helpers/logger.js";
import dayjs from "dayjs";
import * as dotenv from 'dotenv' ;
dotenv.config();


  export const listDomainMaster = async (req, res) => {
    // #swagger.tags = ['Domain']
    /* #swagger.security = [{
                "bearerAuth": []
        }] */
    // #swagger.description = 'Fungsi untuk menampilkan list data domain'
    try {
      const { rowsPerPage, descending, sortBy, page, filter } = req.query;

      const baseQuery = dbDMS("v_mstr_bu")
      if (!rowsPerPage) {
        const response = await baseQuery
        .select('bu_id', 'bu_name', 'bu_status')
        .orderBy("bu_id");
        return res.status(200).json(response);
      }

      const sorting = descending === 'true' ? 'desc' : 'asc';
      const columnSort = sortBy === 'desc' ? 'bu_id asc' : `${sortBy} ${sorting}`;
      const currentPage = Math.floor(page);
      const perPage = Math.floor(rowsPerPage);

      let query = baseQuery
      .select("bu_id", "bu_name", "bu_status")
      
      // Apply filter if provided
      if (filter) {
        query = query.where((subQuery) => {
          subQuery
            .orWhere('bu_id', 'like', `%${filter}%`)
            .orWhere('bu_name', 'like', `%${filter}%`)
            .orWhere('bu_status', 'like', `%${filter}%`)
        });
      }
      
      const response = await query
        .orderByRaw(columnSort)
        .paginate({
          perPage,
          currentPage,
          isLengthAware: true,
        });
      
      res.status(200).json(response);
     
    } catch (error) {
      logger(error, 'GET /listDomainMaster', req.query);
      return res.status(406).json(getErrorResponse(error))
    }
  };

  export const saveDomain = async (req, res) => {
    // #swagger.tags = ['Domain']
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    // #swagger.description = 'Fungsi untuk simpan data domain'
    const trx = await db.transaction();
    try {
      const { fldcode, fldinitial, fldname, fldentity, creator: encryptedCreator } = req.body;
      const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
      const creator = await decrypt(encryptedCreator);

      const existingDomain = await trx("mst_domain")
      .where("domain_code", fldcode)
      .first();

      const domainData = {
        domain_shortname: fldinitial,
        domain_longname: fldname,
        domain_entity: fldentity,
        domain_status: 'active',
        updated_by: creator,
        updated_at: now,
      };
      let action=null,dataString=null;

      if (existingDomain) {
        await trx("mst_domain")
        .update({...domainData,deleted_by: null,deleted_at: null,})
        .where("domain_code", fldcode);
        dataString=objectToString({...domainData,deleted_by: null,deleted_at: null});
        action = 'update';
      }else{
        await trx("mst_domain").insert({domain_code: fldcode,...domainData,created_by: creator,created_at: now,});
        dataString=objectToString({domain_code: fldcode,...domainData,created_by: creator,created_at: now,});
        action = 'insert';
      }
      await trx.commit();
      return res.json("sukses");
    } catch (error) {
      await trx.rollback();
      logger(error, 'POST /saveDomain', req.body);
      return res.status(406).json(getErrorResponse(error))
    }
  };

  export const deleteDomain = async (req, res) => {
    // #swagger.tags = ['Domain']
   /* #swagger.security = [{
           "bearerAuth": []
   }] */
   // #swagger.description = 'Fungsi untuk hapus data domain'
   try {
    const { code, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const creator = await decrypt(encryptedCreator);
    
    await db("mst_domain").where("domain_code", code).update({
      domain_status: 'inactive',
      updated_by: creator,
      updated_at: now,
      deleted_by: creator,
      deleted_at: now,
    });
    return res.json("success");
   } catch (error) {
     logger(error, 'DELETE /deleteDomain', req.body);
     return res.status(406).json(getErrorResponse(error))
   }
 };

 export const listSiteMaster = async (req, res) => {
    // #swagger.tags = ['Domain']
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    // #swagger.description = 'Fungsi untuk menampilkan list data site'
    try {
      const { rowsPerPage, descending, sortBy, page, filter, domain } = req.query;
    
      // Base query builder
      const baseQuery = db("mst_site")
        .where("site_domain", domain)
        .whereNull('deleted_at');
      
      // Simple list without pagination
      if (!rowsPerPage) {
        const response = await baseQuery.orderBy("site_code");
        return res.status(200).json(response);
      }
      
      // Paginated list with optimizations
      const sorting = descending === 'true' ? 'desc' : 'asc';
      const columnSort = sortBy === 'desc' ? 'site_code asc' : `${sortBy} ${sorting}`;
      const currentPage = Math.floor(page);
      const perPage = Math.floor(rowsPerPage);
      
      let query = baseQuery;
      
      // Apply filter if provided
      if (filter) {
        query = query.where((subQuery) => {
          subQuery
            .orWhere('site_code', 'like', `%${filter}%`)
            .orWhere('site_desc', 'like', `%${filter}%`);
        });
      }

      const response = await query
        .orderByRaw(columnSort)
        .paginate({
          perPage,
          currentPage,
          isLengthAware: true,
        });
      res.json(response);
    } catch (error) {
      logger(error, 'GET /listSiteMaster', req.query);
      return res.status(406).json(getErrorResponse(error))
    }
  };

  export const syncSite = async (req, res) => {
    // #swagger.tags = ['Domain']
   /* #swagger.security = [{
           "bearerAuth": []
   }] */
   // #swagger.description = 'Fungsi untuk sync data site dari QAD'
  const { domain, creator: encryptedCreator } = req.body;
  const today = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const creator = encryptedCreator ? await decrypt(encryptedCreator) : null;
   try {
    const domainInfo = await db("mst_domain")
      .where("domain_code", domain)
      .first();
     const args = { parDomain: domainInfo.domain_code,
                    parEntity: domainInfo.domain_entity,
                    parDBLogical:'qaddb'
                   };
       let callWsa;
       callWsa = await getWSA(process.env.WSA, "getDBCsite", args);
       if (!callWsa.tt_site){
        throw {
          message: `Data tidak ada`,
        };
      }
       let siteData = callWsa.tt_site.tt_siteRow;
       await db('mst_site')
        .where('site_domain',domain)
        .update({
          deleted_by:'system',
          deleted_at:today,
        })
       if(siteData){
          const existingSites = await db('mst_site')
          .where('site_domain', domain)
          .select('site_code');
          const existingSiteCodes = new Set(existingSites.map(s => s.site_code));  
          const updatePromises = [];
          const insertData = [];
          siteData.forEach(item => {
            const siteInfo = processSiteItem(item, domain, creator, today);
            
            if (existingSiteCodes.has(item.kd_site)) {
              // Update existing
              updatePromises.push(
                db('mst_site')
                  .where('site_domain', domain)
                  .where('site_code', item.kd_site)
                  .update(siteInfo)
              );
            } else {
              // Insert new
              insertData.push({
                ...siteInfo,
                site_code: item.kd_site,
                created_by: creator || 'system',
                created_at: today,
              });
            }
          });
          
          // Execute batch operations
          await Promise.all([
            ...updatePromises,
            ...(insertData.length > 0 ? [db('mst_site').insert(insertData)] : [])
          ]);
        }

         await db('log_sync').insert(createLogEntry(domain,'SITE','QAD','site_mstr'
          ,creator,'sukses',today));
        return res.json("sukses"); 
   } catch (error) {
    await db('log_sync').insert(createLogEntry(domain,'SITE','QAD','site_mstr'
          ,creator,'error',today))
    return res.status(406).json(getErrorResponse(error))
   }
 };

 export const saveSite = async (req, res) => {
    // #swagger.tags = ['Domain']
   /* #swagger.security = [{
           "bearerAuth": []
         }] */
   // #swagger.description = 'Fungsi untuk menyimpan menu akses site per domain per user'
   const trx = await db.transaction();
   try {
      const { domain, site, empid: encryptedEmpid, creator: encryptedCreator } = req.body;
      const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
      const empid = await decrypt(encryptedEmpid);
      const creator = await decrypt(encryptedCreator);
         
       // Mark existing non-default sites as deleted
      await trx("user_site")
        .where("usite_domain", domain)
        .where("usite_userid", empid)
        .where('usite_default', '<>', 1)
        .update({
          deleted_at: now,
          deleted_by: creator
      });
      
      if (site && site.length > 0) {
         // Get existing sites for batch processing
        const existingSites = await trx('user_site')
            .where('usite_domain', domain)
            .where("usite_userid", empid)
            .whereIn('usite_site', site)
            .select('usite_site');

        const existingSiteCodes = new Set(existingSites.map(s => s.usite_site));
        const updatePromises = [];
        const insertData = [];
        site.forEach(siteCode => {
          const siteData = {
            usite_default: 0,
            updated_at: now,
            updated_by: creator,
            deleted_at: null,
            deleted_by: null,
          };
          
          if (existingSiteCodes.has(siteCode)) {
            // Update existing
            updatePromises.push(
              trx('user_site')
                .where('usite_domain', domain)
                .where("usite_userid", empid)
                .where('usite_site', siteCode)
                .update(siteData)
            );
          } else {
            // Insert new
            insertData.push({
              usite_domain: domain,
              usite_userid: empid,
              usite_site: siteCode,
              ...siteData,
              created_by: creator,
              created_at: now,
            });
          }
        });

        await Promise.all([
          ...updatePromises,
          ...(insertData.length > 0 ? [trx('user_site').insert(insertData)] : [])
        ]); 
      }
      await trx.commit();
      return res.json("sukses");
   } catch (error) {
    await trx.rollback();
    return res.status(406).json(getErrorResponse(error))
   }
 };
 
 export const listMasterRole = async (req, res) => {
  // #swagger.tags = ['Domain']
  // #swagger.description = 'Menampilkan Data Role'
  try {
    const { page, code, needle, descending, sortBy, filter, rowsPerPage } = req.query;
    // Base query builder
    const baseQuery = dbDMS("master_role").whereNull('deleted_at');
    if (!page) {
      const decryptedCode = code ?decrypt(code) : null;
      
      let query = baseQuery.select('role_id', 'role_name');
      
      if (decryptedCode) {
        query = query.where('role_id', decryptedCode);
      }
      
      if (needle) {
        query = query.where('role_name', 'like', `%${needle}%`);
      }
      
      const response = await query.orderBy("role_name").limit(10);
      await encryptRoleIds(response);
      
      return res.status(200).json(response);
    }

    // Paginated list with optimizations
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'role_name asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    
    let query = baseQuery.select(
      "role_id", "role_name", "role_desc",'role_admin', "role_folder_scope", "updated_at"
    );
    
    // Apply filter if provided
    if (filter) {
      query = query.where((subQuery) => {
        subQuery
          .orWhere('role_name', 'like', `%${filter}%`)
          .orWhere('role_desc', 'like', `%${filter}%`);
      });
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({
        perPage,
        currentPage,
        isLengthAware: true,
      });
    
    await encryptRoleIds(response.data);
    res.status(200).json(response);
  } catch (error) {
    return res.status(406).json(getErrorResponse(error))
  }
}

export const saveRole = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data role'
  const trx = await dbDMS.transaction();
  try {
    const { name, longname, id: encryptedId,admin, folder_scope, creator: encryptedCreator } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const id = encryptedId ? decrypt(encryptedId) : '0';
    const creator = decrypt(encryptedCreator);
    
    const roleData = {
      role_name: name,
      role_desc: longname,
      role_admin:admin,
      role_folder_scope: folder_scope || null,
      updated_by: creator,
      updated_at: now,
    };
    // Check if role name already exists
    const existingRole = await trx("master_role")
      .where("role_name", name)
      .where('role_id', '<>', id)
      .first();
    
    if (existingRole) {
      if (existingRole.deleted_at === null) {
        await trx.rollback();
        return res.status(406).json({
          type: 'error',
          message: `Nama role sudah ada, silahkan Coba Lagi`,
        });
      }

      // Restore deleted role
      await trx("master_role")
        .where("role_name", name)
        .update({
          ...roleData,
          deleted_by: null,
          deleted_at: null,
        });
    } else if (id === '0') {
      // Insert new role
      await trx("master_role").insert({
        ...roleData,
        created_by: creator,
        created_at: now,
      });
    } else {
      // Update existing role
      await trx("master_role")
        .where("role_id", id)
        .update(roleData);
    }
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    logger(error, 'POST /saveRole', req.body);
    return res.status(406).json(getErrorResponse(error))
  }
};

export const deleteRole = async (req, res) => {
  // #swagger.tags = ['Domain']
 /* #swagger.security = [{
         "bearerAuth": []
 }] */
 // #swagger.description = 'Fungsi untuk hapus data role'
 try {
  const { id: encryptedId, creator: encryptedCreator } = req.body;
  const id = encryptedId ? decrypt(encryptedId) : 0;
  const creator = decrypt(encryptedCreator);

  const dependencyCheck = await checkRoleDependencies(id);
    
  if (!dependencyCheck.canDelete) {
    return res.status(406).json({
      type: 'error',
      message: dependencyCheck.message,
    });
  }
  
  // Delete the role
  await dbDMS("master_role")
    .where("role_id", id)
    .update({
      deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      deleted_by: creator,
    });

   return res.json("success");
 } catch (error) {
   return res.status(406).json(getErrorResponse(error))
 }
};

export const listRoleAkses = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan group menu access'
  try {
    const { rowsPerPage, descending, sortBy, page, filter, parent } = req.query;
    
    // Simple list without pagination
    if (!rowsPerPage) {
      return res.status(200).json([]);
    }
    
    // Paginated list
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'menu_name asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    const groupId = parent; // Use plain group ID (no decryption needed)
    
    // Get all menus with their access status for this group
    const query = await dbDMS.raw(`
      SELECT 
        m.menu_id as menu,
        m.menu_name,
        m.menu_icon,
        m.menu_link,
        m.menu_parent,
        parent.menu_name as parent_name,
        parent.menu_icon as icon_parent,
        col.col_name,
        col.col_icon,
        CAST(ISNULL(ma.maccess_view, 0) AS INT) as access_view,
        CAST(ISNULL(ma.maccess_add, 0) AS INT) as access_add,
        CAST(ISNULL(ma.maccess_edit, 0) AS INT) as access_edit,
        CAST(ISNULL(ma.maccess_delete, 0) AS INT) as access_delete
      FROM mst_menu m
      LEFT JOIN mst_menu parent ON m.menu_parent = parent.menu_id
      LEFT JOIN collection_det cd ON m.menu_id = cd.coldet_menu AND cd.deleted_at IS NULL
      LEFT JOIN collection_menu col ON cd.coldet_colid = col.colid AND col.deleted_at IS NULL
      LEFT JOIN menu_access ma ON m.menu_id = ma.maccess_menuid 
        AND ma.maccess_group_id = ? 
        AND ma.deleted_at IS NULL
      WHERE m.menu_parent IS NOT NULL 
        AND m.deleted_at IS NULL
        ${filter ? `AND (m.menu_name LIKE '%${filter}%' OR parent.menu_name LIKE '%${filter}%' OR col.col_name LIKE '%${filter}%' OR m.menu_link LIKE '%${filter}%')` : ''}
      ORDER BY ${columnSort}
      OFFSET ? ROWS
      FETCH NEXT ? ROWS ONLY
    `, [groupId, (currentPage - 1) * perPage, perPage]);
    
    // Get total count
    const countQuery = await dbDMS.raw(`
      SELECT COUNT(*) as total
      FROM mst_menu m
      WHERE m.menu_parent IS NOT NULL 
        AND m.deleted_at IS NULL
        ${filter ? `AND (m.menu_name LIKE '%${filter}%')` : ''}
    `);
    
    const data = query;
    const total = countQuery[0].total;
    
    await encryptMenuIds(data);
    
    const response = {
      data: data,
      pagination: {
        total: total,
        perPage: perPage,
        currentPage: currentPage,
        lastPage: Math.ceil(total / perPage)
      }
    };
    
    res.status(200).json(response);
   
  } catch (error) {
    logger(error, 'GET /listRoleAkses', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveRoleAkses = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan group menu access'
  let trx;
  try {
    const { menu: encryptedMenu, role, creator: encryptedCreator, view, add, edit, delete: deleteAccess } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const menu = decrypt(encryptedMenu);
    const groupId = role; // Use plain group ID (no decryption)
    const creator = decrypt(encryptedCreator);

    trx = await dbDMS.transaction();
    
    // Get existing access
    const existingAccess = await trx("menu_access")
      .where("maccess_menuid", menu)
      .where('maccess_group_id', groupId)
      .first();
    
    // Check if access should be soft deleted (no permissions enabled)
    const shouldDelete = !view && !add && !edit && !deleteAccess;
    
    const accessData = {
      maccess_menuid: menu,
      maccess_group_id: groupId,
      maccess_view: view ? 1 : 0,
      maccess_add: add ? 1 : 0,
      maccess_edit: edit ? 1 : 0,
      maccess_delete: deleteAccess ? 1 : 0,
      updated_at: now,
      updated_by: creator,
      deleted_at: shouldDelete ? now : null,
      deleted_by: shouldDelete ? creator : null,
    };
    
    if (!existingAccess) {
      // Insert new access
      await trx("menu_access").insert({
        ...accessData,
        created_by: creator,
        created_at: now,
      });
    } else {
      // Update existing access
      await trx("menu_access")
        .where("maccess_menuid", menu)
        .where('maccess_group_id', groupId)
        .update(accessData);
    }
    
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    if (trx) await trx.rollback();
    logger(error, 'POST /saveRoleAkses', req.body);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const listUserRoleAkses = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
              "bearerAuth": []
      }] */
  // #swagger.description = 'Fungsi untuk menampilkan user role akses'
  try {
    const { rowsPerPage,domain, descending, sortBy, page, filter, empid } = req.query;
    if (!rowsPerPage) return res.status(200).json([]);
    
    const sorting = descending === 'true' ? 'desc' : 'asc';
    const columnSort = sortBy === 'asc' ? 'role_name asc' : `${sortBy} ${sorting}`;
    const currentPage = Math.floor(page);
    const perPage = Math.floor(rowsPerPage);
    const decryptedEmpid = decrypt(empid);
    
    let query = dbDMS("master_role")
      .select("role_id", "role_name", 
        db.raw(`(SELECT grant_user_id FROM user_grant_role WHERE grant_user_id = ? AND grant_bu_id= ? AND grant_urole_id = master_role.role_id and deleted_at is null) as grant_user_id`, [decryptedEmpid,domain]))
      .whereNull('deleted_at');
    
    if (filter) {
      query = query.where('role_name', 'like', `%${filter}%`);
    }
    
    const response = await query
      .orderByRaw(columnSort)
      .paginate({perPage,currentPage,isLengthAware: true});

    await encryptRoleIds(response.data);
    res.status(200).json(response);
  } catch (error) {
    return res.status(406).json({type:'error',message:process.env.DEBUG == 1 ?error.message:`Aplikasi sedang mengalami gangguan, silahkan hubungi tim IT`});
  }
};

export const getRoleAksesByPage = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Get page access permissions for user based on groups'
  try {
    const { role: encryptedEmpid, page, domain } = req.query;
    const empid = decrypt(encryptedEmpid);
    
    // console.log('=== DEBUG pageakses ===');
    // console.log('Encrypted empid:', encryptedEmpid);
    // console.log('Decrypted empid:', empid);
    // console.log('Page:', page);
    // console.log('Domain:', domain);
    
    // Get user's groups for this domain
    const userGroups = await dbDMS('master_user')
      .select('account_type as ugrp_group_id')
      .where({
        'emp_id': empid
      });
    
    // console.log('User groups found:', userGroups);
    
    if (userGroups.length === 0) {
      return res.status(404).json({
        type: 'error',
        message: 'User not found or has no groups assigned'
      });
    }
    
    const groupIds = userGroups.map(g => g.ugrp_group_id);
    // console.log('Group IDs:', groupIds);
    
    // Check if menu exists
    const menuExists = await dbDMS('mst_menu')
      .where('menu_link', page)
      .whereNull('deleted_at')
      .first();
    
    // console.log('Menu exists:', menuExists);
    
    if (!menuExists) {
      return res.status(404).json({
        type: 'error',
        message: `Menu with link '${page}' not found in mst_menu table`
      });
    }
    
    // Check if menu_access exists for these groups
    const accessExists = await dbDMS('menu_access')
      .whereIn("maccess_group_id", groupIds)
      .where('maccess_menuid', menuExists.menu_id)
      .whereNull('deleted_at')
      .first();
    
    // console.log('Access exists:', accessExists);
    
    if (!accessExists) {
      return res.status(404).json({
        type: 'error',
        message: `No menu_access found for groups [${groupIds.join(', ')}] to menu '${page}' (menu_id: ${menuExists.menu_id})`
      });
    }
    
    // Check if user is admin (has ADMIN group or group name contains Admin)
    // const isAdmin = userGroups.some(g => 
    //   g.grp_code === 'ADMIN' || 
    //   g.grp_name.toLowerCase().includes('admin')
    // );
    const isAdmin = false; // Default to false for now
    
    // Get menu access for this page
    const response = await dbDMS('menu_access')
      .join('mst_menu', 'menu_access.maccess_menuid', 'mst_menu.menu_id')
      .whereIn("maccess_group_id", groupIds)
      .where('menu_link', page)
      .whereNull('menu_access.deleted_at')
      .whereNull('mst_menu.deleted_at')
      .first();
    
    console.log('Final response:', response);
    
    if (!response) {
      return res.status(404).json({
        type: 'error',
        message: 'Access data not found after all checks - this should not happen'
      });
    }
    
    // Encrypt access permissions
    const data = {
      view: await encrypt(response.maccess_view ? '1' : '0'),
      add: await encrypt(response.maccess_add ? '1' : '0'),
      edit: await encrypt(response.maccess_edit ? '1' : '0'),
      delete: await encrypt(response.maccess_delete ? '1' : '0'),
      admin: await encrypt(isAdmin ? '1' : '0'),
      folder_scope: await encrypt('All') // Default folder scope
    };
    
    console.log('Returning data:', data);
    console.log('=== END DEBUG ===');
    
    res.status(200).json(data);
  } catch (error) {
    logger(error, 'GET /pageakses', req.query);
    return res.status(406).json(getErrorResponse(error));
  }
};

export const saveUserRoleAkses = async (req, res) => {
  // #swagger.tags = ['Domain']
  /* #swagger.security = [{
          "bearerAuth": []
  }] */
  // #swagger.description = 'Fungsi untuk simpan data grant user role'
  const trx = await dbDMS.transaction();
  try {
    const { role: encryptedRole, creator: encryptedCreator, empid:encryptedEmpid, granted,domain } = req.body;
    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const [role, creator, empid] = [decrypt(encryptedRole), decrypt(encryptedCreator), decrypt(encryptedEmpid)];

    const existingGrant = await trx("user_grant_role").where({grant_user_id:empid,grant_urole_id:role,grant_bu_id:domain}).first();
    if (granted) {
      if (existingGrant) {
        await trx("user_grant_role").where({grant_user_id:empid,grant_urole_id:role,grant_bu_id:domain}).update({updated_at:now,updated_by:creator,deleted_at:null,deleted_by:null});
      } else {
        await trx("user_grant_role").insert({grant_user_id:empid,grant_urole_id:role,grant_bu_id:domain,created_by:creator,created_at:now,updated_by:creator,updated_at:now});
      }
    } else {
      if (existingGrant) {
        await trx("user_grant_role").where({grant_user_id:empid,grant_urole_id:role,grant_bu_id:domain}).update({deleted_at:now,deleted_by:creator});
      }
    }
    await trx.commit();
    return res.json("sukses");
  } catch (error) {
    await trx.rollback();
    return res.status(406).json(getErrorResponse(error));
  }
};
