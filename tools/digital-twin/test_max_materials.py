import unittest
from types import SimpleNamespace as NS
from max_materials import install, VRAY_OVERRIDE


class MaterialTests(unittest.TestCase):
    def importer(self):
        def original(filename, search, obj, mat):
            obj.data.materials.append(mat.label)
            return mat.label
        return NS(adjust_material=original, get_guid=lambda n:n.guid,
                  get_references=lambda n:n.refs, get_cls_name=lambda n:n.label)

    def test_visible_base_selected_not_gi(self):
        imp = self.importer(); report={}; install(imp, report)
        base=NS(guid=2,label='stone'); gi=NS(guid=2,label='GI white')
        wrapper=NS(guid=VRAY_OVERRIDE,refs=[None,base,gi])
        obj=NS(data=NS(materials=[]))
        self.assertEqual(imp.adjust_material('',False,obj,wrapper),'stone')
        self.assertEqual(obj.data.materials,['stone'])
        self.assertEqual(report['materialWrappersResolved'],1)

    def test_cycle_rejected(self):
        imp=self.importer(); install(imp,{})
        mat=NS(guid=VRAY_OVERRIDE,refs=[]);mat.refs=[None,mat]
        with self.assertRaises(ValueError):imp.adjust_material('',False,NS(data=NS(materials=[])),mat)

    def test_missing_base_reported_not_guessed(self):
        imp=self.importer();report={};install(imp,report)
        mat=NS(guid=VRAY_OVERRIDE,refs=[None,None,NS(guid=2,label='GI')])
        obj=NS(data=NS(materials=[]))
        self.assertIsNone(imp.adjust_material('',False,obj,mat))
        self.assertEqual(obj.data.materials,[])
        self.assertEqual(len(report['unsupportedMaterials']),1)


if __name__=='__main__':unittest.main()
